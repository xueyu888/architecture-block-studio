import { ZodError } from "zod";
import { parseBlockDesignDocument, type BlockDesignDocument } from "../model";

export class DesignLoadError extends Error {
  readonly causeDetail: string;

  constructor(message: string, causeDetail: string) {
    super(message);
    this.name = "DesignLoadError";
    this.causeDetail = causeDetail;
  }
}

function describeError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`)
      .join("\n");
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function loadDesignFromObject(input: unknown): BlockDesignDocument {
  try {
    return parseBlockDesignDocument(input);
  } catch (error) {
    throw new DesignLoadError("The design document does not match BlockDesignDocument v2.", describeError(error));
  }
}

export async function loadDesignFromUrl(url: string): Promise<BlockDesignDocument> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new DesignLoadError(`Unable to fetch design from ${url}.`, describeError(error));
  }

  if (!response.ok) {
    throw new DesignLoadError(`Unable to fetch design from ${url}.`, `HTTP ${response.status} ${response.statusText}`);
  }

  try {
    return loadDesignFromObject(await response.json());
  } catch (error) {
    if (error instanceof DesignLoadError) throw error;
    throw new DesignLoadError(`Unable to parse design from ${url}.`, describeError(error));
  }
}

export async function loadDesignFromFile(file: File): Promise<BlockDesignDocument> {
  try {
    return loadDesignFromObject(JSON.parse(await file.text()));
  } catch (error) {
    if (error instanceof DesignLoadError) throw error;
    throw new DesignLoadError(`Unable to parse ${file.name}.`, describeError(error));
  }
}

export function requestedDesignUrl(): string | undefined {
  const requested = new URLSearchParams(window.location.search).get("design")?.trim();
  return requested || undefined;
}
