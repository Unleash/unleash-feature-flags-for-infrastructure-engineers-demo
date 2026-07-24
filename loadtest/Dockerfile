FROM debian:bullseye-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential libssl-dev zlib1g-dev git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The upstream wrk2 does not build on aarch64 - use the fork from
# https://github.com/giltene/wrk2/pull/145 (pinned), same as scripts/install-wrk2.sh.
# The sed fixes option parsing on Linux aarch64, where char is unsigned and
# `char c != -1` never terminates the getopt_long() loop.
RUN git clone https://github.com/PauloMigAlmeida/wrk2 /wrk2 \
    && git -C /wrk2 checkout ce2be93071dfb4a0040a8bae17d7c4ab544408f6 \
    && sed -i 's/char c, \*\*header = headers;/int c; char **header = headers;/' /wrk2/src/wrk.c \
    && make -C /wrk2

FROM debian:bullseye-slim

COPY --from=build /wrk2/wrk /usr/local/bin/wrk2
COPY tier.lua /scripts/tier.lua

ENTRYPOINT ["wrk2"]
