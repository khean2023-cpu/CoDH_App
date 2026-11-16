import { handleApi } from "./handler.js";

export default {
  fetch(request: Request) {
    const url = new URL(request.url);
    const apiPath = url.searchParams.get("__api_path");
    if (!apiPath) return new Response("Not found.", { status: 404 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    return handleApi(request, `/api${apiPath}`);
  },
};
