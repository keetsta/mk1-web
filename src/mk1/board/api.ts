export type BoardEntry = {
  card: string;
  nickname: string | null;
  score: number;
  solved: number;
  instructions: number;
  cycles: number;
};

export type BoardPage = { entries: BoardEntry[]; nextOffset?: number };

const API = "/mk1/api/leaderboard";
export const boardUnavailable = "leaderboard is unavailable";
export const boardNumber = new Intl.NumberFormat("en");

async function request<Result>(options: RequestInit, url = API): Promise<Result> {
  const response = await fetch(url, options).catch(() => null);
  const body: unknown = await response?.json().catch(() => null);
  if (response?.ok && body) return body as Result;
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    throw new Error(body.error);
  }
  throw new Error(boardUnavailable);
}

function isEntry(value: unknown): value is BoardEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<BoardEntry>;
  return typeof row.card === "string" && (row.nickname === null || typeof row.nickname === "string") &&
    [row.score, row.solved, row.instructions, row.cycles].every((n) => Number.isSafeInteger(n) && n! >= 0);
}

export async function loadBoard(signal: AbortSignal, offset = 0): Promise<BoardPage> {
  const board = await request<BoardPage>({ signal }, `${API}?limit=100&offset=${offset}`);
  if (!Array.isArray(board.entries) || board.entries.length > 100 || !board.entries.every(isEntry) ||
      (board.nextOffset !== undefined && (!Number.isSafeInteger(board.nextOffset) ||
        board.nextOffset <= offset || board.nextOffset > 10000))) throw new Error(boardUnavailable);
  return board;
}

function post<Result>(value: object): Promise<Result> {
  return request<Result>({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

export async function publishBoardResult(token: string, nickname?: string): Promise<BoardEntry> {
  const { entry } = await post<{ entry: BoardEntry }>({ token, nickname });
  if (!isEntry(entry)) throw new Error(boardUnavailable);
  return entry;
}

export async function changeNickname(
  token: string, nickname: string, sign: (nonce: string, name: string) => Promise<string>,
): Promise<BoardEntry> {
  const challenge = await post<{ nonce: string; nickname: string }>({ action: "nickname-challenge", token, nickname });
  if (!/^[0-9a-f]{32}$/.test(challenge.nonce) || challenge.nickname !== nickname) throw new Error(boardUnavailable);
  const proof = await sign(challenge.nonce, challenge.nickname);
  const { entry } = await post<{ entry: BoardEntry }>({ action: "set-nickname", nonce: challenge.nonce, proof });
  if (!isEntry(entry)) throw new Error(boardUnavailable);
  return entry;
}
