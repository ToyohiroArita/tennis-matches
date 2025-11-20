"use client";

import { useState } from "react";

type Team = [string, string]; // ペア（2人）
type CourtMatch = {
  court: number;
  team1: string[];
  team2?: string[];
};
type RoundView = {
  roundIndex: number;
  courts: CourtMatch[];
  restingPlayers: string[];
};

const defaultPlayers = `Aさん
Bさん
Cさん
Dさん
Eさん
Fさん
Gさん
Hさん`;

// 配列シャッフル（フィッシャー–イェーツ）
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pairKey(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `${x}::${y}`;
}

function parsePlayers(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l, idx, arr) => l !== "" && arr.indexOf(l) === idx);
}

function parsePairLines(text: string, players: string[]): Team[] {
  const setPlayers = new Set(players);
  const pairs: Team[] = [];

  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .forEach((line) => {
      const parts = line
        .split(/[,\s、]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length !== 2) return;
      const [a, b] = parts as [string, string];
      if (!setPlayers.has(a) || !setPlayers.has(b)) return;
      const [x, y] = [a, b].sort() as [string, string];
      if (!pairs.find((p) => p[0] === x && p[1] === y)) {
        pairs.push([x, y]);
      }
    });

  return pairs;
}

// 1試合分のペアを作る（前試合のペアを避けつつ）
function findRoundPairing(
  players: string[],
  prevPairsSet: Set<string> | null,
  fixedPairs: Team[],
  forbiddenPairs: Team[]
): { teams: Team[]; resting: string[] } | null {
  const order = shuffleArray(players);
  const forbiddenSet = new Set(forbiddenPairs.map(([a, b]) => pairKey(a, b)));

  const fixedMap = new Map<string, string>();
  for (const [a, b] of fixedPairs) {
    fixedMap.set(a, b);
    fixedMap.set(b, a);
  }

  const used = new Set<string>();
  const teams: Team[] = [];

  function backtrack(): boolean {
    const remaining = order.filter((p) => !used.has(p));
    if (remaining.length <= 1) {
      return true;
    }

    const p1 = remaining[0];
    const fixedPartner = fixedMap.get(p1);
    let candidates: string[];

    if (fixedPartner) {
      if (!remaining.includes(fixedPartner)) {
        return false;
      }
      candidates = [fixedPartner];
    } else {
      candidates = remaining.slice(1);
    }

    for (const p2 of candidates) {
      const key = pairKey(p1, p2);

      if (forbiddenSet.has(key)) continue;
      if (prevPairsSet && prevPairsSet.has(key)) continue;

      used.add(p1);
      used.add(p2);
      teams.push([p1, p2]);

      if (backtrack()) return true;

      teams.pop();
      used.delete(p1);
      used.delete(p2);
    }

    return false;
  }

  const ok = backtrack();
  if (!ok) return null;

  const resting = order.filter((p) => !used.has(p));
  return { teams, resting };
}

// 複数試合分を生成（1〜matchCount）
function generateRounds(
  players: string[],
  courtCount: number,
  matchCount: number,
  fixedPairs: Team[],
  forbiddenPairs: Team[]
): RoundView[] | null {
  const rounds: RoundView[] = [];
  let prevPairsSet: Set<string> | null = null;

  for (let roundIndex = 0; roundIndex < matchCount; roundIndex++) {
    let result: { teams: Team[]; resting: string[] } | null = null;

    for (let attempt = 0; attempt < 100; attempt++) {
      result = findRoundPairing(
        players,
        prevPairsSet,
        fixedPairs,
        forbiddenPairs
      );
      if (result) break;
    }

    if (!result) {
      return null;
    }

    const teams = result.teams;
    const restingPlayers: string[] = [...result.resting];

    const courts: CourtMatch[] = [];
    const teamsForCourt = [...teams];

    let courtNo = 1;
    while (courtNo <= courtCount && teamsForCourt.length >= 2) {
      const team1 = teamsForCourt.shift()!;
      const team2 = teamsForCourt.shift()!;
      courts.push({ court: courtNo, team1, team2 });
      courtNo++;
    }

    teamsForCourt.forEach((team) => {
      restingPlayers.push(...team);
    });

    prevPairsSet = new Set(teams.map(([a, b]) => pairKey(a, b)));

    rounds.push({ roundIndex, courts, restingPlayers });
  }

  return rounds;
}

export default function Page() {
  const [playersText, setPlayersText] = useState(defaultPlayers);
  const [courtCount, setCourtCount] = useState(2);
  const [matchCount, setMatchCount] = useState(3);
  const [fixedPairsText, setFixedPairsText] = useState("");
  const [forbiddenPairsText, setForbiddenPairsText] = useState("");
  const [rounds, setRounds] = useState<RoundView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = () => {
    const players = parsePlayers(playersText);

    if (players.length < 2) {
      setError("メンバーは2人以上入力してください。");
      setRounds(null);
      return;
    }

    if (courtCount <= 0) {
      setError("コート数は1以上を指定してください。");
      setRounds(null);
      return;
    }

    const fixedPairs = parsePairLines(fixedPairsText, players);
    const forbiddenPairs = parsePairLines(forbiddenPairsText, players);

    const result = generateRounds(
      players,
      courtCount,
      matchCount,
      fixedPairs,
      forbiddenPairs
    );

    if (!result) {
      setError(
        "条件が厳しすぎて組み合わせを生成できませんでした。\n固定ペア・禁止ペア・コート数・試合数などを少し緩めてみてください。"
      );
      setRounds(null);
    } else {
      setError(null);
      setRounds(result);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-sky-50 via-slate-50 to-emerald-50 px-3 py-6 md:px-6 md:py-10">
      <div className="text-3xl font-bold text-red-500 mb-4">
        これは Tailwind のテストです
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row">
        {/* 左側：設定パネル */}
        <section className="w-full rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-slate-200 md:w-[40%] md:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">
                Awesome Tennis
              </p>
              <h1 className="text-lg font-bold text-slate-900 md:text-xl">
                テニス対戦表ジェネレーター
              </h1>
              <p className="mt-1 text-xs text-slate-600">
                メンバー・コート数・固定ペア・禁止ペアを設定して、
                ダブルスの組み合わせを自動生成します。
              </p>
            </div>
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-lg">
              🎾
            </span>
          </div>

          {/* フォーム */}
          <div className="mt-3 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                メンバー（1行に1名）
                <span className="ml-1 text-[11px] font-normal text-slate-500">
                  ※順不同・重複は自動で除外
                </span>
              </label>
              <textarea
                rows={7}
                value={playersText}
                onChange={(e) => setPlayersText(e.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs md:text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  コート数
                </label>
                <input
                  type="number"
                  min={1}
                  value={courtCount}
                  onChange={(e) => setCourtCount(Number(e.target.value) || 1)}
                  className="block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  試合数
                </label>
                <select
                  value={matchCount}
                  onChange={(e) => setMatchCount(Number(e.target.value))}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} 試合分
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  固定ペア
                  <span className="ml-1 text-[11px] font-normal text-slate-500">
                    （1行に「Aさん,Bさん」）
                  </span>
                </label>
                <textarea
                  rows={3}
                  value={fixedPairsText}
                  onChange={(e) => setFixedPairsText(e.target.value)}
                  placeholder={"例)\nAさん,Bさん\nCさん,Dさん"}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] md:text-xs shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  禁止ペア
                  <span className="ml-1 text-[11px] font-normal text-slate-500">
                    （1行に「Aさん,Bさん」）
                  </span>
                </label>
                <textarea
                  rows={3}
                  value={forbiddenPairsText}
                  onChange={(e) => setForbiddenPairsText(e.target.value)}
                  placeholder={"例)\nEさん,Fさん\nGさん,Hさん"}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] md:text-xs shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              className="inline-flex w-full items-center justify-center rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-sky-500/30 transition hover:bg-sky-700 active:bg-sky-800"
            >
              組み合わせを生成する
            </button>

            {error && (
              <p className="whitespace-pre-wrap rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
          </div>
        </section>

        {/* 右側：結果パネル */}
        <section className="w-full rounded-2xl bg-white/95 p-4 shadow-md ring-1 ring-slate-200 md:w-[60%] md:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 md:text-base">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs">
                ✓
              </span>
              組み合わせ結果
            </h2>
            <p className="text-[11px] text-slate-500">
              試合ごとに直前と同じペアにならないよう調整しています。
            </p>
          </div>

          {!rounds && (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 text-center">
              <p className="text-xs text-slate-500 md:text-sm">
                左の設定を入力して「組み合わせを生成する」を押すと、
                <br className="hidden md:block" />
                ここに対戦表が表示されます。
              </p>
            </div>
          )}

          {rounds && (
            <div className="flex flex-col gap-3 md:gap-4">
              {rounds.map((round) => (
                <div
                  key={round.roundIndex}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3 md:px-4 md:py-3.5"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                        第 {round.roundIndex + 1} 試合
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      コート数: {round.courts.length}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {round.courts.map((court) => (
                      <div
                        key={court.court}
                        className="rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-2 text-xs md:text-sm"
                      >
                        <div className="mb-0.5 text-[11px] font-semibold text-sky-900">
                          コート {court.court}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-slate-800">
                          <span>
                            {court.team1[0]} &amp; {court.team1[1]}
                          </span>
                          {court.team2 && (
                            <>
                              <span className="text-[10px] text-slate-400">
                                vs
                              </span>
                              <span>
                                {court.team2[0]} &amp; {court.team2[1]}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {round.restingPlayers.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                        休憩
                      </span>
                      <span>
                        {Array.from(new Set(round.restingPlayers)).join("、")}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
