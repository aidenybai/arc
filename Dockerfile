# Build and run a Volt server (framework/) on the Arc runtime.
FROM erlang:27-alpine

ARG GLEAM_VERSION=v1.17.0
ADD https://github.com/gleam-lang/gleam/releases/download/${GLEAM_VERSION}/gleam-${GLEAM_VERSION}-x86_64-unknown-linux-musl.tar.gz /tmp/gleam.tar.gz
RUN tar -xzf /tmp/gleam.tar.gz -C /usr/local/bin && rm /tmp/gleam.tar.gz

WORKDIR /app
COPY . .
RUN gleam build

ENV PORT=3000
EXPOSE 3000
CMD ["gleam", "run", "--", "--event-loop", "framework/examples/dist/server.js"]
