import type { RequestDocument, UserDocument } from "../db/schema.js";

const isApproved = (user: UserDocument) => user.status === "Approved";

const isHumanResourceDepartmentHead = (user: UserDocument) =>
  user.role === "Department Head" &&
  (user.headOfDept || user.dept) === "Human Resource Department";

export const canManageLeaveCredits = (user: UserDocument) =>
  user.status === "Approved" && user.role === "Human Resource";

export const isHumanResourceReviewer = (user: UserDocument, users: UserDocument[]) => {
  const hasHumanResourceDepartmentHead = users.some(candidate =>
    isApproved(candidate) && isHumanResourceDepartmentHead(candidate),
  );
  return isHumanResourceDepartmentHead(user) ||
    (!hasHumanResourceDepartmentHead && user.role === "Human Resource");
};

const isDepartmentHeadApplicant = (request: RequestDocument, users: UserDocument[]) =>
  users.some(candidate => candidate.id === request.applicantId && candidate.role === "Department Head");

export const isRequestLapsed = (request: RequestDocument) => {
  const actionDate =
    request.type === "Exchange of Duty" ? request.startDate :
      request.type === "Missed Log" ? request.logDate :
        request.type === "Extra Off Request" ? request.extraOffDate :
          request.type === "Leave" ? request.startDate :
            null;
  if (!actionDate || !/^\d{4}-\d{2}-\d{2}$/.test(actionDate)) return false;
  const nowParts = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = nowParts.find(part => part.type === "year")?.value;
  const month = nowParts.find(part => part.type === "month")?.value;
  return Boolean(year && month && actionDate.slice(0, 7) !== `${year}-${month}`);
};

export const canAccessRequest = (
  user: UserDocument,
  request: RequestDocument,
  users: UserDocument[],
) => {
  if (!isApproved(user)) return false;
  if (user.role === "Admin") return true;
  if (request.applicantId === user.id) return true;
  if (user.role === "Employee") {
    return request.type === "Exchange of Duty" &&
      request.status === "Pending Duty Swap Approval" &&
      request.taggedUsers?.includes(user.id) === true;
  }
  if (user.role === "Department Head") {
    return request.section === (user.headOfDept || user.dept) ||
      (isHumanResourceReviewer(user, users) && [
        "Pending Human Resource Verification",
        "Pending Administrative Officer V Approval",
        "Pending Chief of Hospital Approval",
        "Approved",
        "Rejected",
      ].includes(request.status));
  }
  if (isHumanResourceReviewer(user, users)) {
    return [
      "Pending Human Resource Verification",
      "Pending Administrative Officer V Approval",
      "Pending Chief of Hospital Approval",
      "Approved",
      "Rejected",
    ].includes(request.status);
  }
  if (user.role === "Administrative Officer V") {
    return [
      "Pending Administrative Officer V Approval",
      "Pending Chief of Hospital Approval",
      "Approved",
      "Rejected",
    ].includes(request.status);
  }
  if (user.role === "Chief of Hospital") {
    return [
      "Pending Chief of Hospital Approval",
      "Approved",
      "Rejected",
    ].includes(request.status);
  }
  return false;
};

export const getApprovalRole = (
  user: UserDocument,
  request: RequestDocument,
  users: UserDocument[],
) => {
  if (!isApproved(user)) return null;
  if (
    user.role === "Employee" &&
    request.type === "Exchange of Duty" &&
    request.status === "Pending Duty Swap Approval" &&
    request.taggedUsers?.includes(user.id)
  ) return "Covering Employee";
  if (
    user.role === "Department Head" &&
    request.section === (user.headOfDept || user.dept) &&
    request.status === "Pending Dept Head Approval" &&
    request.deptHeadApproval === "Pending"
  ) return "Department Head";
  if (
    isHumanResourceReviewer(user, users) &&
    request.status === "Pending Human Resource Verification" &&
    (request.hrApproval || "Pending") === "Pending"
  ) return "Human Resource";
  if (
    user.role === "Administrative Officer V" &&
    request.status === "Pending Administrative Officer V Approval" &&
    ["Approved", "Not required"].includes(request.deptHeadApproval || "") &&
    ["Approved", "Not required"].includes(request.hrApproval || "") &&
    request.finalApproval === "Pending"
  ) return "Administrative Officer V";
  if (
    user.role === "Chief of Hospital" &&
    request.status === "Pending Chief of Hospital Approval" &&
    request.finalApproval === "Pending Chief of Hospital Approval"
  ) return "Chief of Hospital";
  return null;
};

export const createApprovalUpdate = (
  request: RequestDocument,
  user: UserDocument,
  users: UserDocument[],
  nextStatus: string,
  date: string,
) => {
  if (isRequestLapsed(request)) return null;
  const role = getApprovalRole(user, request, users);
  if (!role) return null;

  const isReject = nextStatus === "Rejected";
  const approvedAt = new Date().toISOString();
  const update: Partial<RequestDocument> = {
    status: nextStatus,
    approvedBy: user.name,
    approvalDate: date,
    approvedAt,
    logs: [
      ...(request.logs || []),
      {
        date,
        approvedAt,
        action: `${isReject ? "REJECT" : "APPROVE"} by ${user.name} (${role})`,
        user: user.name,
        userId: user.id,
        ...(!isReject && user.signature ? { signature: user.signature } : {}),
      },
    ],
  };

  if (role === "Covering Employee") {
    const departmentHeadApplicant = isDepartmentHeadApplicant(request, users);
    const expectedStatus = departmentHeadApplicant
      ? "Pending Human Resource Verification"
      : "Pending Dept Head Approval";
    if (!isReject && nextStatus !== expectedStatus) return null;
    if (!isReject && departmentHeadApplicant) {
      update.deptHeadApproval = "Not required";
      update.hrApproval = "Pending";
    }
  } else if (role === "Department Head") {
    if (!isReject && nextStatus !== "Pending Human Resource Verification") return null;
    update.deptHeadApproval = isReject ? "Rejected" : "Approved";
    if (!isReject) update.hrApproval = "Pending";
  } else if (role === "Human Resource") {
    if (!isReject && nextStatus !== "Pending Administrative Officer V Approval") return null;
    update.hrApproval = isReject ? "Rejected" : "Approved";
  } else if (role === "Administrative Officer V") {
    if (!isReject && nextStatus !== "Pending Chief of Hospital Approval") return null;
    update.finalApproval = isReject ? "Rejected" : "Pending Chief of Hospital Approval";
  } else if (role === "Chief of Hospital") {
    if (!["Approved", "Rejected"].includes(nextStatus)) return null;
    update.finalApproval = nextStatus;
  }

  return update;
};
