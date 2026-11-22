export type BoardEntry = {
  card: string;
  nickname: string | null;
  score: number;
  solved: number;
  instructions: number;
  cycles: number;
};

const API = "/mk1/api/leaderboard";
export const boardUnavailable = "leaderboard is unavailable";
export const boardNumber = new Intl.NumberFormat("en");

async function request<Result>(options?: RequestInit): Promise<Result> {
  const response = await fetch(API, options).catch(() => null);
  const body: unknown = await response?.json().catch(() => null);
  if (response?.ok && body) return body as Result;
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    throw new Error(body.error);
  }
  throw new Error(boardUnavailable);
}

export async function loadBoard(signal: AbortSignal): Promise<BoardEntry[]> {
  const board = await request<{ entries: BoardEntry[] }>({ signal });
  if (!Array.isArray(board.entries)) throw new Error(boardUnavailable);
  return board.entries;
}

export async function publishBoardResult(token: string, nickname?: string): Promise<BoardEntry> {
  const { entry } = await request<{ entry: BoardEntry }>({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, nickname }),
  });
  if (!entry) throw new Error(boardUnavailable);
  return entry;
}
