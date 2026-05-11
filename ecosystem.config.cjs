module.exports = {
  apps: [
    {
      name: "storm-ai",
      script: "pnpm",
      args: "start",
      cwd: "/var/www/storm-ai",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
}
