"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Draft = {
  id: string;
  name: string;
  grade: number;
  program: "flag" | "tackle";
  status: "scheduled" | "active" | "closed";
  base_roster_limit: number;
};

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("drafts")
        .select("id,name,grade,program,status,base_roster_limit")
        .order("created_at", { ascending: false });

      if (error) setError(error.message);
      else setDrafts((data ?? []) as Draft[]);
    };

    load();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Drafts</h1>
      {error && <p className="text-red-600">{error}</p>}

      <div className="space-y-2">
        {drafts.map((d) => (
          <Link
            key={d.id}
            href={`/drafts/${d.id}`}
            className="block border rounded p-3 hover:bg-gray-50"
          >
            <div className="font-medium">{d.name}</div>
            <div className="text-sm text-gray-600">
              Grade {d.grade} • {d.program} • {d.status} • Roster {d.base_roster_limit}
            </div>
          </Link>
        ))}
        {drafts.length === 0 && !error && <p>No drafts found.</p>}
      </div>
    </div>
  );
}
