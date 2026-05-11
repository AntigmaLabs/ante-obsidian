import type { AnteThinkingLevel, ApprovalDecision } from "../types";

export interface AnteEventEnvelope {
  event?: unknown;
  parent?: string;
}

export type AnteOperation =
  | {
      StartSession: {
        model: string;
        provider: string;
        streaming: boolean;
        thinking: AnteThinkingLevel | null;
        policy?: "Auto" | "Ask" | "Deny";
        system_prompt?: string;
        append_system_prompt?: string;
        allowed_tools?: string[];
        disallowed_tools?: string[];
        cwd?: string;
      };
    }
  | {
      ResumeSession: {
        session_id: string;
      };
    }
  | {
      UpdateSession: {
        model: {
          name: string;
        };
        provider: string;
      };
    }
  | {
      UserInput: string;
    }
  | {
      ApprovalResponse: {
        turn_id: string;
        responses: Array<[string, ApprovalDecision]>;
      };
    }
  | "Interrupt"
  | "Shutdown";

const generateUlid = (): string => {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let timestamp = Date.now();
  let result = "";
  for (let index = 0; index < 10; index += 1) {
    result = alphabet[timestamp % 32] + result;
    timestamp = Math.floor(timestamp / 32);
  }
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  for (let index = 0; index < randomBytes.length; index += 1) {
    result += alphabet[randomBytes[index] % 32];
  }
  return result;
};

export const generateOpId = (): string => `op_${generateUlid()}`;

export const serializeOperation = (op: AnteOperation, id = generateOpId()): string => JSON.stringify({ op, id });

export const parseEnvelope = (raw: string): AnteEventEnvelope | null => {
  try {
    return JSON.parse(raw) as AnteEventEnvelope;
  } catch {
    return null;
  }
};
