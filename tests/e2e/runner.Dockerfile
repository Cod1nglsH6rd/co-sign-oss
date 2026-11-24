# The end-to-end test's own container on a self-hosted runner (ci.yml, e2e job,
# runner.environment == 'self-hosted'). Built with no context:
#
#   docker build -t <tag> - < tests/e2e/runner.Dockerfile
#
# The official Playwright image for the version in package-lock.json brings
# Chromium and its system libraries, so the runner needs no sudo and no browser
# build for its own OS. The static Docker CLI and Compose plugin let the test
# still read the setup code (docker compose logs app) and move a link's expiry
# (docker compose exec db) through the runner's Docker socket, mounted at run time.
# tests/e2eWorkflow.test.js checks that the Playwright tag matches the lock file.
FROM docker:29.1.3-cli AS docker-cli

FROM mcr.microsoft.com/playwright:v1.58.2-noble
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
