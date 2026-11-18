FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html config.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
ARG GIT_SHA
RUN set -eu; \
    cd /usr/share/nginx/html; \
    checksum="$(find assets -type f -exec sha256sum {} + | sort | sha256sum)"; \
    asset_version="${checksum%% *}"; \
    sed -i -e "s/v=local/v=$asset_version/g" \
        -e "s/name=\"flowsuite-asset-version\" content=\"local\"/name=\"flowsuite-asset-version\" content=\"$asset_version\"/" index.html; \
    printf 'git=%s\nassets=%s\n' "${GIT_SHA:-unknown}" "$asset_version" > version.txt
EXPOSE 80
