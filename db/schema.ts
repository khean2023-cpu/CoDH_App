export type LeaveApplicationDetails = {
  formVariant?: "CSC" | "COS";
  position?: string;
  salary?: string;
  leaveType?: string;
  leaveTypeOther?: string;
  purpose?: string;
  relieverName?: string;
  relieverDesignation?: string;
  relieverTemporaryDesignation?: string;
  locationType?: string;
  destination?: string;
  sickTreatment?: string;
  illness?: string;
  studyPurposes?: string[];
  otherPurpose?: string;
  commutation?: string;
};

export interface UserDocument {
  id: string;
  name: string;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  email: string;
  emailNormalized: string;
  role: string;
  dept?: string | null;
  headOfDept?: string | null;
  title?: string | null;
  employmentType: string;
  requestedRole?: string | null;
  requestedDept?: string | null;
  requestedEmploymentType?: string | null;
  salary?: string | null;
  salaryHistory: {
    id: string;
    adjustedAt: string;
    previousSalary: string | null;
    newSalary: string;
  }[];
  leaveCredits?: {
    vacation?: number | null;
    sick?: number | null;
    mandatoryForced?: number | null;
    maternity?: number | null;
    paternity?: number | null;
    specialPrivilege?: number | null;
    soloParent?: number | null;
    study?: number | null;
    vawc?: number | null;
    rehabilitation?: number | null;
    specialLeaveForWomen?: number | null;
    specialEmergency?: number | null;
    adoption?: number | null;
    wellness?: number | null;
    updatedAt: string;
    updatedBy: string;
  } | null;
  avatar?: string | null;
  signature?: string | null;
  passwordHash: string;
  status: string;
  createdAt: Date;
}

export interface RequestDocument {
  id: string;
  type: string;
  subType?: string | null;
  section?: string | null;
  applicantId: string;
  applicantName?: string | null;
  dateFiled?: string | null;
  logDate?: string | null;
  timeIn?: string | null;
  timeOut?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  totalDays?: number | null;
  leaveDetails?: LeaveApplicationDetails | null;
  extraOffDate?: string | null;
  reason?: string | null;
  attachmentName?: string | null;
  attachmentId?: string | null;
  status: string;
  deptHeadApproval?: string | null;
  hrApproval?: string | null;
  finalApproval?: string | null;
  approvedBy?: string | null;
  approvalDate?: string | null;
  taggedUsers?: string[] | null;
  logs?: { date: string; action: string; user: string; userId?: string; signature?: string }[] | null;
  createdAt: Date;
}

export interface NotificationDocument {
  id: string;
  userId: string;
  requestId?: string | null;
  title: string;
  message: string;
  date?: string | null;
  read: boolean;
  createdAt: Date;
}

export interface ArchiveDocument {
  id: string;
  originalReqId: string;
  applicantId: string;
  recipientId?: string | null;
  applicantName?: string | null;
  type?: string | null;
  section?: string | null;
  status?: string | null;
  archivedDate?: string | null;
  reason?: string | null;
  createdAt: Date;
}

export interface AttachmentDocument {
  id: string;
  requestId?: string | null;
  uploadedBy?: string | null;
  fileName: string;
  contentType: string;
  size: number;
  blobKey: string;
  createdAt: Date;
}

export interface ProfileMediaDocument {
  id: string;
  userId: string;
  mediaType: string;
  fileName: string;
  contentType: string;
  size: number;
  blobKey: string;
  createdAt: Date;
}

export interface SpaceInvadersScoreDocument {
  userId: string;
  highScore: number;
  updatedAt: Date;
}

export interface SessionDocument {
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}
