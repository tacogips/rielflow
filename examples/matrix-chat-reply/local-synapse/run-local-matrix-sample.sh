#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"

PORT="${DIVEDRA_MATRIX_SAMPLE_PORT:-18008}"
HOMESERVER_URL="http://127.0.0.1:${PORT}"
RUN_ROOT="${DIVEDRA_MATRIX_SAMPLE_RUN_ROOT:-${REPO_ROOT}/tmp/matrix-chat-reply-sample}"
DATA_DIR="${DIVEDRA_MATRIX_SAMPLE_DATA_DIR:-${RUN_ROOT}/synapse-data}"
EVENT_ROOT="${RUN_ROOT}/.divedra-events"
ARTIFACT_ROOT="${RUN_ROOT}/artifacts"
REGISTRATION_SECRET="${DIVEDRA_MATRIX_SAMPLE_REGISTRATION_SECRET:-divedra-local-registration-secret}"
ALICE_PASSWORD="${DIVEDRA_MATRIX_SAMPLE_ALICE_PASSWORD:-divedra-alice-password}"
BOT_PASSWORD="${DIVEDRA_MATRIX_SAMPLE_BOT_PASSWORD:-divedra-bot-password}"
BOT_USER_ID="@divedra:localhost"
ALICE_USER_ID="@alice:localhost"

case "${RUN_ROOT}" in
  "${REPO_ROOT}"/*)
    SYNC_TOKEN_PATH="${RUN_ROOT#"${REPO_ROOT}/"}/sync/local-matrix.json"
    ;;
  *)
    echo "DIVEDRA_MATRIX_SAMPLE_RUN_ROOT must be under ${REPO_ROOT}" >&2
    exit 2
    ;;
esac

cd "${REPO_ROOT}"

listener_pid=""

cleanup() {
  if [[ -n "${listener_pid}" ]] && kill -0 "${listener_pid}" 2>/dev/null; then
    kill "${listener_pid}" 2>/dev/null || true
    wait "${listener_pid}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

json_field() {
  local file="$1"
  local field="$2"
  bun -e '
    const data = JSON.parse(await Bun.file(process.argv[1]).text());
    const path = process.argv[2].split(".");
    let value = data;
    for (const key of path) value = value?.[key];
    if (typeof value !== "string" || value.length === 0) process.exit(1);
    console.log(value);
  ' "${file}" "${field}"
}

url_encode() {
  VALUE="$1" bun -e 'console.log(encodeURIComponent(process.env.VALUE ?? ""))'
}

login_user() {
  local localpart="$1"
  local password="$2"
  local output_file="$3"
  USER_LOCALPART="${localpart}" USER_PASSWORD="${password}" bun -e '
    const body = {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: process.env.USER_LOCALPART },
      password: process.env.USER_PASSWORD,
    };
    console.log(JSON.stringify(body));
  ' > "${RUN_ROOT}/login-${localpart}.json"
  curl -fsS \
    -X POST \
    -H "content-type: application/json" \
    --data-binary "@${RUN_ROOT}/login-${localpart}.json" \
    "${HOMESERVER_URL}/_matrix/client/v3/login" \
    > "${output_file}"
}

register_user() {
  local localpart="$1"
  local password="$2"
  local output_file="${RUN_ROOT}/register-${localpart}.log"

  if docker compose -f "${COMPOSE_FILE}" exec -T synapse \
    register_new_matrix_user \
    -c /data/homeserver.yaml \
    -u "${localpart}" \
    -p "${password}" \
    --no-admin \
    --exists-ok \
    "http://localhost:8008" \
    > "${output_file}" 2>&1; then
    return 0
  fi

  if grep -qi "already" "${output_file}"; then
    return 0
  fi

  cat "${output_file}" >&2
  return 1
}

wait_for_synapse() {
  for _ in $(seq 1 90); do
    if curl -fsS "${HOMESERVER_URL}/_matrix/client/versions" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  docker compose -f "${COMPOSE_FILE}" logs synapse >&2 || true
  echo "Synapse did not become ready at ${HOMESERVER_URL}" >&2
  return 1
}

write_event_configuration() {
  ROOM_ID="${ROOM_ID}" ROOM_ALIAS="${ROOM_ALIAS}" EVENT_ROOT="${EVENT_ROOT}" SYNC_TOKEN_PATH="${SYNC_TOKEN_PATH}" bun -e '
    await Bun.write(
      `${process.env.EVENT_ROOT}/sources/local-matrix.json`,
      JSON.stringify(
        {
          id: "local-matrix",
          kind: "matrix",
          provider: "matrix",
          homeserverUrlEnv: "DIVEDRA_MATRIX_HOMESERVER_URL",
          accessTokenEnv: "DIVEDRA_MATRIX_ACCESS_TOKEN",
          userId: "@divedra:localhost",
          rooms: [
            {
              roomId: process.env.ROOM_ID,
              alias: `#${process.env.ROOM_ALIAS}:localhost`,
            },
          ],
          sync: {
            pollTimeoutMs: 1000,
            sinceTokenPath: process.env.SYNC_TOKEN_PATH,
          },
        },
        null,
        2,
      ) + "\n",
    );

    await Bun.write(
      `${process.env.EVENT_ROOT}/destinations/local-matrix-chat.json`,
      JSON.stringify(
        {
          id: "local-matrix-chat",
          kind: "chat",
          sourceId: "local-matrix",
          target: {
            provider: "matrix",
            conversationId: process.env.ROOM_ID,
          },
        },
        null,
        2,
      ) + "\n",
    );

    await Bun.write(
      `${process.env.EVENT_ROOT}/bindings/local-matrix-to-workflow.json`,
      JSON.stringify(
        {
          id: "local-matrix-to-workflow",
          sourceId: "local-matrix",
          outputDestinations: ["local-matrix-chat"],
          match: { eventType: "chat.message" },
          workflowName: "matrix-chat-reply",
          inputMapping: {
            mode: "event-input",
            mirrorToHumanInput: true,
          },
          execution: {
            async: false,
            dedupeWindowMs: 86400000,
          },
        },
        null,
        2,
      ) + "\n",
    );
  '
}

wait_for_listener() {
  local log_file="$1"
  for _ in $(seq 1 30); do
    if grep -q '"sources"' "${log_file}" 2>/dev/null || grep -q "events listening" "${log_file}" 2>/dev/null; then
      return 0
    fi
    if [[ -n "${listener_pid}" ]] && ! kill -0 "${listener_pid}" 2>/dev/null; then
      cat "${log_file}" >&2 || true
      echo "divedra events serve exited before it was ready" >&2
      return 1
    fi
    sleep 1
  done

  cat "${log_file}" >&2 || true
  echo "divedra events serve did not report readiness" >&2
  return 1
}

find_reply_event() {
  local messages_file="$1"
  local expected_text="$2"
  EXPECTED_TEXT="${expected_text}" BOT_USER_ID="${BOT_USER_ID}" bun -e '
    const data = JSON.parse(await Bun.file(process.argv[1]).text());
    const chunk = Array.isArray(data.chunk) ? data.chunk : [];
    const match = chunk.find((event) =>
      event?.type === "m.room.message" &&
      event?.sender === process.env.BOT_USER_ID &&
      event?.content?.body === process.env.EXPECTED_TEXT
    );
    if (!match?.event_id) process.exit(1);
    console.log(match.event_id);
  ' "${messages_file}"
}

echo "Preparing local Synapse data directory: ${DATA_DIR}"
mkdir -p "${DATA_DIR}" "${RUN_ROOT}"
export DIVEDRA_MATRIX_SAMPLE_DATA_DIR="${DATA_DIR}"

if [[ ! -f "${DATA_DIR}/homeserver.yaml" ]]; then
  docker compose -f "${COMPOSE_FILE}" run --rm synapse generate
fi

if ! grep -q "^registration_shared_secret:" "${DATA_DIR}/homeserver.yaml"; then
  {
    echo ""
    echo "registration_shared_secret: \"${REGISTRATION_SECRET}\""
    echo "enable_registration: false"
  } >> "${DATA_DIR}/homeserver.yaml"
fi

docker compose -f "${COMPOSE_FILE}" up -d --force-recreate
wait_for_synapse

mkdir -p "${RUN_ROOT}"
register_user "alice" "${ALICE_PASSWORD}"
register_user "divedra" "${BOT_PASSWORD}"

login_user "alice" "${ALICE_PASSWORD}" "${RUN_ROOT}/alice-login.json"
login_user "divedra" "${BOT_PASSWORD}" "${RUN_ROOT}/bot-login.json"
ALICE_TOKEN="$(json_field "${RUN_ROOT}/alice-login.json" "access_token")"
BOT_TOKEN="$(json_field "${RUN_ROOT}/bot-login.json" "access_token")"

ROOM_ALIAS="divedra-sample-$(date +%s)-${RANDOM}"
ROOM_CREATE_BODY="${RUN_ROOT}/create-room.json"
ROOM_ALIAS="${ROOM_ALIAS}" BOT_USER_ID="${BOT_USER_ID}" bun -e '
  const body = {
    room_alias_name: process.env.ROOM_ALIAS,
    name: "Divedra Matrix Sample",
    preset: "private_chat",
    invite: [process.env.BOT_USER_ID],
  };
  console.log(JSON.stringify(body));
' > "${ROOM_CREATE_BODY}"

curl -fsS \
  -X POST \
  -H "authorization: Bearer ${ALICE_TOKEN}" \
  -H "content-type: application/json" \
  --data-binary "@${ROOM_CREATE_BODY}" \
  "${HOMESERVER_URL}/_matrix/client/v3/createRoom" \
  > "${RUN_ROOT}/create-room-response.json"

ROOM_ID="$(json_field "${RUN_ROOT}/create-room-response.json" "room_id")"
ROOM_ID_ENCODED="$(url_encode "${ROOM_ID}")"

curl -fsS \
  -X POST \
  -H "authorization: Bearer ${BOT_TOKEN}" \
  -H "content-type: application/json" \
  --data-binary "{}" \
  "${HOMESERVER_URL}/_matrix/client/v3/rooms/${ROOM_ID_ENCODED}/join" \
  > "${RUN_ROOT}/bot-join-response.json"

rm -rf "${EVENT_ROOT}" "${ARTIFACT_ROOT}" "${RUN_ROOT}/sync"
mkdir -p \
  "${EVENT_ROOT}/sources" \
  "${EVENT_ROOT}/destinations" \
  "${EVENT_ROOT}/bindings" \
  "${ARTIFACT_ROOT}"
write_event_configuration

bun run "${REPO_ROOT}/src/main.ts" events validate \
  --workflow-definition-dir "${REPO_ROOT}/examples" \
  --event-root "${EVENT_ROOT}" \
  --output json \
  > "${RUN_ROOT}/event-validate.json"

LISTENER_LOG="${RUN_ROOT}/events-serve.log"
: > "${LISTENER_LOG}"
DIVEDRA_MATRIX_HOMESERVER_URL="${HOMESERVER_URL}" \
DIVEDRA_MATRIX_ACCESS_TOKEN="${BOT_TOKEN}" \
  bun run "${REPO_ROOT}/src/main.ts" events serve \
    --workflow-definition-dir "${REPO_ROOT}/examples" \
    --event-root "${EVENT_ROOT}" \
    --artifact-root "${ARTIFACT_ROOT}" \
    --output json \
    > "${LISTENER_LOG}" 2>&1 &
listener_pid="$!"
wait_for_listener "${LISTENER_LOG}"

MESSAGE="hello from local Matrix at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
EXPECTED_REPLY="Matrix sample received from ${ALICE_USER_ID}: ${MESSAGE}"
TXN_ID="alice-$(date +%s)-${RANDOM}"
MESSAGE_BODY="${RUN_ROOT}/alice-message.json"
MESSAGE="${MESSAGE}" bun -e '
  console.log(JSON.stringify({ msgtype: "m.text", body: process.env.MESSAGE }));
' > "${MESSAGE_BODY}"

curl -fsS \
  -X PUT \
  -H "authorization: Bearer ${ALICE_TOKEN}" \
  -H "content-type: application/json" \
  --data-binary "@${MESSAGE_BODY}" \
  "${HOMESERVER_URL}/_matrix/client/v3/rooms/${ROOM_ID_ENCODED}/send/m.room.message/${TXN_ID}" \
  > "${RUN_ROOT}/alice-send-response.json"

REPLY_EVENT_ID=""
for _ in $(seq 1 90); do
  curl -fsS \
    -H "authorization: Bearer ${ALICE_TOKEN}" \
    "${HOMESERVER_URL}/_matrix/client/v3/rooms/${ROOM_ID_ENCODED}/messages?dir=b&limit=50" \
    > "${RUN_ROOT}/room-messages.json"
  if REPLY_EVENT_ID="$(find_reply_event "${RUN_ROOT}/room-messages.json" "${EXPECTED_REPLY}")"; then
    break
  fi
  if [[ -n "${listener_pid}" ]] && ! kill -0 "${listener_pid}" 2>/dev/null; then
    cat "${LISTENER_LOG}" >&2 || true
    echo "divedra events serve exited before the Matrix reply was observed" >&2
    exit 1
  fi
  sleep 1
done

if [[ -z "${REPLY_EVENT_ID}" ]]; then
  cat "${LISTENER_LOG}" >&2 || true
  echo "Timed out waiting for Matrix reply: ${EXPECTED_REPLY}" >&2
  exit 1
fi

bun run "${REPO_ROOT}/src/main.ts" events list \
  --artifact-root "${ARTIFACT_ROOT}" \
  --source local-matrix \
  --output json \
  > "${RUN_ROOT}/event-receipts.json"

bun run "${REPO_ROOT}/src/main.ts" events replies \
  --artifact-root "${ARTIFACT_ROOT}" \
  --status sent \
  --output json \
  > "${RUN_ROOT}/event-replies.json"

echo "Matrix sample verification passed."
echo "Homeserver: ${HOMESERVER_URL}"
echo "Room: ${ROOM_ID}"
echo "Alice message: ${MESSAGE}"
echo "Bot reply event: ${REPLY_EVENT_ID}"
echo "Runtime artifacts: ${ARTIFACT_ROOT}"
echo "Generated event config: ${EVENT_ROOT}"
