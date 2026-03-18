"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Draft = {
  id: string;
  name: string;
  status: "scheduled" | "active" | "closed";
  grade: number;
  program: "flag" | "tackle";
  current_pick_index: number;
  current_skill_rank: number;
  base_roster_limit: number;
};

type SlotRow = {
  pick_index: number;
  round: number;
  slot_type: "standard" | "bonus";
  team_id: string;
  team_name: string;
};

type PickRow = {
  pick_index: number;
  team_name: string;
  player_name: string;
  pick_type: string;
};

type PlayerRow = {
  id: string;
  first_name: string;
  last_name: string;
  skill_rank: number;
  is_returning: boolean;
  returning_team_id: string | null;
  returning_team_name: string | null;
};

export default function DraftRoomPage() {
  const params = useParams();
  const rawDraftId = (params as any)?.draftId as string | string[] | undefined;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [search, setSearch] = useState("");
  const [showReturning, setShowReturning] = useState(false);

  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  const [adminBusy, setAdminBusy] = useState(false);
  const [rankChoice, setRankChoice] = useState<number>(1);

  const [error, setError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const picksByIndex = useMemo(() => {
    const m = new Map<number, PickRow>();
    for (const p of picks) m.set(p.pick_index, p);
    return m;
  }, [picks]);

  const currentSlot = useMemo(() => {
    if (!draft) return null;
    return slots.find((s) => s.pick_index === draft.current_pick_index) ?? null;
  }, [draft, slots]);

  async function loadDraftAndBoard(validDraftId: string) {
    setError(null);

    const { data: d, error: dErr } = await supabase
      .from("drafts")
      .select(
        "id,name,status,grade,program,current_pick_index,current_skill_rank,base_roster_limit"
      )
      .eq("id", validDraftId)
      .single();

    if (dErr) return setError(dErr.message);
    setDraft(d as Draft);

    const { data: s, error: sErr } = await supabase
      .from("pick_slots")
      .select("pick_index,round,slot_type, team_id, teams(name)")
      .eq("draft_id", validDraftId)
      .order("pick_index", { ascending: true });

    if (sErr) return setError(sErr.message);

    setSlots(
      (s ?? []).map((r: any) => ({
        pick_index: r.pick_index,
        round: r.round,
        slot_type: r.slot_type,
        team_id: r.team_id,
        team_name: r.teams.name,
      }))
    );

    const { data: p, error: pErr } = await supabase
      .from("picks")
      .select("pick_index,pick_type, teams(name), players(first_name,last_name)")
      .eq("draft_id", validDraftId)
      .order("pick_index", { ascending: true });

    if (pErr) return setError(pErr.message);

    setPicks(
      (p ?? []).map((r: any) => ({
        pick_index: r.pick_index,
        pick_type: r.pick_type,
        team_name: r.teams.name,
        player_name: `${r.players.first_name} ${r.players.last_name}`,
      }))
    );
  }

  async function loadAvailablePlayers(validDraftId: string, q: string) {
    if (!draft) return;
    setPlayerError(null);

    let query = supabase
      .from("available_players")
      .select(
        "id,first_name,last_name,skill_rank,is_returning,returning_team_id,returning_team_name"
      )
      .eq("draft_id", validDraftId)
      .eq("grade", draft.grade)
      .eq("program", draft.program);

    if (!showReturning) {
      query = query.eq("is_returning", false);
    }

    query = query
      .order("is_returning", { ascending: true })
      .order("skill_rank", { ascending: true })
      .order("last_name", { ascending: true })
      .limit(200);

    const trimmed = q.trim();
    if (trimmed) {
      query = query.or(
        `first_name.ilike.%${trimmed}%,last_name.ilike.%${trimmed}%`
      );
    }

    const { data, error } = await query;
    if (error) setPlayerError(error.message);
    else setPlayers((data ?? []) as PlayerRow[]);
  }

  function getDraftDisabledReason(p: PlayerRow): string | null {
    if (!draft) return "Draft not loaded";
    if (draft.status !== "active") return "Draft is not active";
    if (!currentSlot) return "Current slot not loaded";

    // Bonus slots can only draft free agents
    if (currentSlot.slot_type === "bonus" && p.is_returning) {
      return "Bonus pick must be a free agent";
    }

    // Returning players can only be drafted by their own team (on their turn)
    if (p.is_returning) {
      if (!p.returning_team_id) return "Returning team not set";
      if (p.returning_team_id !== currentSlot.team_id) {
        return `Returning to ${
          p.returning_team_name ?? "(unassigned)"
        } — not eligible this pick`;
      }
    }

    return null;
  }

  async function draftPlayer(playerId: string) {
    if (!draftId) return;
    setPlayerError(null);
    setBusyPlayerId(playerId);

    const { error } = await supabase.rpc("make_pick", {
      p_draft_id: draftId,
      p_player_id: playerId,
    });

    setBusyPlayerId(null);

    if (error) {
      setPlayerError(error.message);
      return;
    }

    await loadDraftAndBoard(draftId);
    await loadAvailablePlayers(draftId, search);
  }

  async function resetDraft() {
    if (!draftId) return;

    const ok = window.confirm(
      "Reset this draft? This will delete ALL picks and reset the current pick to 1."
    );
    if (!ok) return;

    setPlayerError(null);
    setResetBusy(true);

    const { error } = await supabase.rpc("reset_draft", { p_draft_id: draftId });

    setResetBusy(false);

    if (error) {
      setPlayerError(error.message);
      return;
    }

    await loadDraftAndBoard(draftId);
    await loadAvailablePlayers(draftId, search);
  }

  async function cleanupOrphans() {
    const ok = window.confirm(
      "Run orphan cleanup? This will delete invalid rows across drafts/teams/players/picks."
    );
    if (!ok) return;

    setPlayerError(null);
    setAdminBusy(true);

    const { error } = await supabase.rpc("cleanup_orphans");

    setAdminBusy(false);

    if (error) {
      setPlayerError(error.message);
      return;
    }

    if (draftId) {
      await loadDraftAndBoard(draftId);
      await loadAvailablePlayers(draftId, search);
    }
  }

  async function setDraftStatus(status: "scheduled" | "active" | "closed") {
    if (!draftId) return;
    setPlayerError(null);
    setAdminBusy(true);

    const { error } = await supabase.rpc("set_draft_status", {
      p_draft_id: draftId,
      p_status: status,
    });

    setAdminBusy(false);

    if (error) {
      setPlayerError(error.message);
      return;
    }

    await loadDraftAndBoard(draftId);
    await loadAvailablePlayers(draftId, search);
  }

  async function applyOpenRank() {
    if (!draftId) return;
    setPlayerError(null);
    setAdminBusy(true);

    const { error } = await supabase.rpc("set_open_skill_rank", {
      p_draft_id: draftId,
      p_rank: rankChoice,
    });

    setAdminBusy(false);

    if (error) {
      setPlayerError(error.message);
      return;
    }

    await loadDraftAndBoard(draftId);
    await loadAvailablePlayers(draftId, search);
  }

  useEffect(() => {
    if (!draftId) return;

    loadDraftAndBoard(draftId);

    const channel = supabase
      .channel(`draft-${draftId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "picks", filter: `draft_id=eq.${draftId}` },
        async () => {
          await loadDraftAndBoard(draftId);
          if (draft) await loadAvailablePlayers(draftId, search);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drafts", filter: `id=eq.${draftId}` },
        () => loadDraftAndBoard(draftId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  useEffect(() => {
    if (!draftId || !draft) return;
    setRankChoice(draft.current_skill_rank);
    loadAvailablePlayers(draftId, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, draft?.grade, draft?.program]);

  useEffect(() => {
    if (!draftId || !draft) return;
    const t = setTimeout(() => loadAvailablePlayers(draftId, search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, showReturning]);

  if (!draftId) return <p className="p-6">Loading draft…</p>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{draft?.name ?? "Draft Room"}</h1>

        {draft && currentSlot && (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            On the clock: <b>{currentSlot.team_name}</b> • Slot: <b>{currentSlot.slot_type}</b> • Pick{" "}
            <b>{draft.current_pick_index}</b> • Open Skill Rank: <b>{draft.current_skill_rank}</b> • Status:{" "}
            <b>{draft.status}</b>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            className="border rounded px-3 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50"
            onClick={resetDraft}
            disabled={resetBusy}
            title="Testing only"
          >
            {resetBusy ? "Resetting…" : "Reset Draft (testing)"}
          </button>

          <button
            className="border rounded px-3 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50"
            onClick={cleanupOrphans}
            disabled={adminBusy}
            title="Testing only"
          >
            Cleanup Orphans
          </button>

          <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 mx-1" />

          <button
            className="border rounded px-3 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50"
            onClick={() => setDraftStatus("active")}
            disabled={adminBusy}
          >
            Start Draft
          </button>

          <button
            className="border rounded px-3 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50"
            onClick={() => setDraftStatus("closed")}
            disabled={adminBusy}
          >
            Close Draft
          </button>

          <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 mx-1" />

          <label className="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
            Open Rank
            <select
              className="border rounded px-2 py-2 bg-white dark:bg-black/20 text-gray-900 dark:text-gray-100"
              value={rankChoice}
              onChange={(e) => setRankChoice(parseInt(e.target.value, 10))}
              disabled={adminBusy}
            >
              {[1, 2, 3, 4, 5].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <button
            className="border rounded px-3 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50"
            onClick={applyOpenRank}
            disabled={adminBusy}
          >
            Set Rank
          </button>

          {adminBusy && (
            <span className="text-sm text-gray-600 dark:text-gray-300">Working…</span>
          )}
        </div>

        {error && <p className="text-red-600 mt-2">{error}</p>}
        {playerError && <p className="text-red-600 mt-2">{playerError}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 border rounded">
          <div className="grid grid-cols-5 gap-2 p-3 text-sm font-medium border-b text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-900/40">
            <div>Pick</div>
            <div>Round</div>
            <div>Slot</div>
            <div>Team</div>
            <div>Selection</div>
          </div>

          <div className="divide-y">
            {slots.map((s) => {
              const pick = picksByIndex.get(s.pick_index);
              const isCurrent = draft?.current_pick_index === s.pick_index;

              return (
                <div
                  key={s.pick_index}
                  className={`grid grid-cols-5 gap-2 p-3 text-sm text-gray-900 dark:text-gray-100 ${
                    isCurrent ? "bg-yellow-50 dark:bg-yellow-900/40" : ""
                  }`}
                >
                  <div>{s.pick_index}</div>
                  <div>{s.round}</div>
                  <div>{s.slot_type}</div>
                  <div>{s.team_name}</div>
                  <div>{pick ? `${pick.player_name} (${pick.pick_type})` : "—"}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border rounded p-3 space-y-3">
          <div className="space-y-2">
            <div className="font-medium text-gray-900 dark:text-gray-100">Available Players</div>

            <input
              className="w-full border rounded px-3 py-2 bg-white dark:bg-black/20 text-gray-900 dark:text-gray-100"
              placeholder="Search first or last name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={showReturning}
                onChange={(e) => setShowReturning(e.target.checked)}
              />
              Show returning players
            </label>

            <div className="text-xs text-gray-600 dark:text-gray-300">
              Showing up to 200 undrafted players for this division
            </div>
          </div>

          <div className="max-h-[60vh] overflow-auto divide-y border rounded">
            {players.map((p) => {
              const disabledReason = getDraftDisabledReason(p);
              const isDisabled = !!disabledReason;
              const isBusy = busyPlayerId === p.id;

              return (
                <div key={p.id} className="p-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate text-gray-900 dark:text-gray-100">
                      {p.first_name} {p.last_name}
                    </div>
                    <div className="text-xs text-gray-600 dark:text.gray-300">
                      Rank {p.skill_rank}
                      {p.is_returning
                        ? ` • Returning to ${p.returning_team_name ?? "(unassigned)"}`
                        : " • Free Agent"}
                    </div>
                    {isDisabled && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {disabledReason}
                      </div>
                    )}
                  </div>

                  <button
                    className="shrink-0 bg-black text-white rounded px-3 py-2 disabled:opacity-50"
                    onClick={() => draftPlayer(p.id)}
                    disabled={isBusy || isDisabled}
                    title={disabledReason ?? "Draft this player"}
                  >
                    {isBusy ? "Drafting…" : "Draft"}
                  </button>
                </div>
              );
            })}

            {players.length === 0 && (
              <div className="p-3 text-sm text-gray-600 dark:text-gray-300">
                No available players found.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}