export default function handler(_req, res) {
  const commitSha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.GITHUB_SHA ||
    "unknown";
  res.status(200).json({
    commitSha,
    vercelEnv: process.env.VERCEL_ENV || "",
    renderService: process.env.RENDER_SERVICE_NAME || "",
    buildTimestamp: process.env.BUILD_TIMESTAMP || ""
  });
}
