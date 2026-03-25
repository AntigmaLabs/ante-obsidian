import type { RuntimeApprovalDecision } from "../core/types";

export interface AnteEventEnvelope {
  event?: unknown;
}

export type AnteOperation =
  | {
      StartSession: {
        model: string;
        provider: string;
        streaming: boolean;
      };
    }
  | {
      UserInput: string;
    }
  | {
      ApprovalResponse: {
        turn_id: string;
        responses: Array<[string, RuntimeApprovalDecision]>;
      };
    };

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

const generateOpId = (): string => `op_${generateUlid()}`;

export const serializeOperation = (op: AnteOperation): string => JSON.stringify({ op, id: generateOpId() });

export const parseEnvelope = (raw: string): AnteEventEnvelope | null => {
  try {
    return JSON.parse(raw) as AnteEventEnvelope;
  } catch {
    return null;
  }
};
