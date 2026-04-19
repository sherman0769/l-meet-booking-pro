import "server-only";

export type AdminAlertLevel = "immediate_action" | "needs_action";

export type AdminAlertInput = {
  connected: boolean;
  reauthRequired: boolean;
  credentialSource: "firestore" | "env_fallback" | "missing";
  pendingSyncJobs: number;
  checkedAt: string;
};

export type AdminAlertEvaluation = {
  shouldAlert: boolean;
  level: AdminAlertLevel | null;
  signature: string | null;
  message: string | null;
  checkedAt: string;
};

function buildImmediateActionMessage(input: AdminAlertInput) {
  return [
    "[L-Meet Admin Alert]",
    "Google OAuth / Calendar 異常，請立即處理。",
    `connected: ${input.connected}`,
    `reauthRequired: ${input.reauthRequired}`,
    `credentialSource: ${input.credentialSource}`,
    `pendingSyncJobs: ${input.pendingSyncJobs}`,
    `checkedAt: ${input.checkedAt}`,
    "建議動作：重新授權 Google Calendar，並檢查 admin 後台待補償項目。",
  ].join("\n");
}

function buildNeedsActionMessage(input: AdminAlertInput) {
  return [
    "[L-Meet Admin Alert]",
    "待同步任務累積過多，請儘速處理。",
    `pendingSyncJobs: ${input.pendingSyncJobs}`,
    `checkedAt: ${input.checkedAt}`,
    "建議動作：進入 admin 後台檢查待補償項目。",
  ].join("\n");
}

export function evaluateAdminAlert(input: AdminAlertInput): AdminAlertEvaluation {
  const checkedAt = input.checkedAt;

  const isImmediateAction =
    input.reauthRequired ||
    !input.connected ||
    input.credentialSource === "missing";

  if (isImmediateAction) {
    const level: AdminAlertLevel = "immediate_action";
    return {
      shouldAlert: true,
      level,
      signature: `${level}|${input.connected}|${input.reauthRequired}|${input.credentialSource}|${input.pendingSyncJobs}`,
      message: buildImmediateActionMessage(input),
      checkedAt,
    };
  }

  const isNeedsAction = input.pendingSyncJobs >= 5;
  if (isNeedsAction) {
    const level: AdminAlertLevel = "needs_action";
    return {
      shouldAlert: true,
      level,
      signature: `${level}|${input.pendingSyncJobs}`,
      message: buildNeedsActionMessage(input),
      checkedAt,
    };
  }

  return {
    shouldAlert: false,
    level: null,
    signature: null,
    message: null,
    checkedAt,
  };
}
