"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Draft = {
  id: string;
  name: string;
  status: string;
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

export default function DraftRoomPage() {
  const params = useParams<{ draftId: string }>();
  const draftId = params.draftId;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const picksByIndex = useMemo(() => {
    const m = new Map<number, PickRow>();
    for (const p of picks) m.set(p.pick_index, p);
    return m;
  }, [picks]);

  async function loadAll() {
    setError(null);

    const { data: d, error: dErr } = await supabase
      .from("drafts")
      .select("id,name,status,current_pick_index,current_skill_rank,base_roster_limit")
      .eq("id", draftId)
      .single();

    if (dErr) return setError(dErr.message);
    setDraft(d as Draft);

    const { data: s, error: sErr } = await supabase
      .from("pick_slots")
      .select("pick_index,round,slot_type, teams(name)")
      .eq("draft_id", draftId)
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
      .eq("draft_id", draftId)
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

  useEffect(() => {
    loadAll();

    // Realtime: refresh picks and draft pointer on changes
    const channel = supabase
      .channel(`draft-${draftId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "picks", filter: `draft_id=eq.${draftId}` },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drafts", filter: `id=eq.${draftId}` },
        () => loadAll()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{draft?.name ?? "Draft Room"}</h1>
        {draft && (
          <p className="text-sm text-gray-600">
            Status: {draft.status} • Open Skill Rank: {draft.current_skill_rank} • Current Pick:{" "}
            {draft.current_pick_index}
          </p>
        )}
        {error && <p className="text-red-600 mt-2">{error}</p>}
      </div>

      <div className="border rounded">
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
    </div>
  );
}
