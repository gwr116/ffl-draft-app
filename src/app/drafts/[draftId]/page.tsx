"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Draft = {
  id: string;
  name: string;
  status: string;
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
  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const picksByIndex = useMemo(() => {
    const m = new Map<number, PickRow>();
    for (const p of picks) m.set(p.pick_index, p);
    return m;
  }, [picks]);

  async function loadDraftAndBoard(validDraftId: string) {
    setError(null);

    const { data: d, error: dErr } = await supabase
      .from("drafts")
      .select("id,name,status,grade,program,current_pick_index,current_skill_rank,base_roster_limit")
      .eq("id", validDraftId)
      .single();

    if (dErr) return setError(dErr.message);
    setDraft(d as Draft);

    const { data: s, error: sErr } = await supabase
      .from("pick_slots")
      .select("pick_index,round,slot_type, teams(name)")
      .eq("draft_id", validDraftId)
      .order("pick_index", { ascending: true });

    if (sErr) return setError(sErr.message);

    setSlots(
      (s ?? []).map((r: any) => ({
        pick_index: r.pick_index,
        round: r.round,
        slot_type: r.slot_type,
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

    // Server-side filter from the view (undrafted only)
    let query = supabase
      .from("available_players")
      .select("id,first_name,last_name,skill_rank,is_returning,returning_team_id,returning_team_name")
      .eq("draft_id", validDraftId)
      .eq("grade", draft.grade)
      .eq("program", draft.program)
      .order("skill_rank", { ascending: true })
      .order("last_name", { ascending: true })
      .limit(200);

    const trimmed = q.trim();
    if (trimmed) {
      // Search first OR last name
      query = query.or(`first_name.ilike.%${trimmed}%,last_name.ilike.%${trimmed}%`);
    }

    const { data, error } = await query;
    if (error) setPlayerError(error.message);
    else setPlayers((data ?? []) as PlayerRow[]);
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

    // Board will update via realtime, but we also refresh available players quickly
    await loadDraftAndBoard(draftId);
    await loadAvailablePlayers(draftId, search);
  }

  useEffect(() => {
    if (!draftId) return;

    // initial load
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

  // When draft loads/changes, load players
  useEffect(() => {
    if (!draftId || !draft) return;
    loadAvailablePlayers(draftId, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, draft?.grade, draft?.program]);

  // Debounced search
  useEffect(() => {
    if (!draftId || !draft) return;
    const t = setTimeout(() => loadAvailablePlayers(draftId, search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (!draftId) return <p className="p-6">Loading draft…</p>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{draft?.name ?? "Draft Room"}</h1>
        {draft && (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Status: {draft.status} • Division: Grade {draft.grade} {draft.program} • Open Skill Rank:{" "}
            {draft.current_skill_rank} • Current Pick: {draft.current_pick_index}
          </p>
        )}
        {error && <p className="text-red-600 mt-2">{error}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Draft Board */}
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

        {/* Available Players */}
        <div className="border rounded p-3 space-y-3">
          <div className="space-y-1">
            <div className="font-medium text-gray-900 dark:text-gray-100">Available Players</div>
            <input
              className="w-full border rounded px-3 py-2 bg-white dark:bg-black/20 text-gray-900 dark:text-gray-100"
              placeholder="Search first or last name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="text-xs text-gray-600 dark:text-gray-300">
              Showing up to 200 undrafted players for this division
            </div>
            {playerError && <p className="text-sm text-red-600">{playerError}</p>}
          </div>

          <div className="max-h-[60vh] overflow-auto divide-y border rounded">
            {players.map((p) => (
              <div key={p.id} className="p-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate text-gray-900 dark:text-gray-100">
                    {p.first_name} {p.last_name}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    Rank {p.skill_rank}
                    {p.is_returning
                      ? ` • Returning to ${p.returning_team_name ?? "Team"}`
                      : " • Free Agent"}
                  </div>
                </div>
                <button
                  className="shrink-0 bg-black text-white rounded px-3 py-2 disabled:opacity-50"
                  onClick={() => draftPlayer(p.id)}
                  disabled={busyPlayerId === p.id}
                >
                  {busyPlayerId === p.id ? "Drafting…" : "Draft"}
                </button>
              </div>
            ))}
            {players.length === 0 && (
              <div className="p-3 text-sm text-gray-600 dark:text-gray-300">No available players found.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
