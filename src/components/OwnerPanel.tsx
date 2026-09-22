import { FormEvent, useEffect, useState } from "react";
import { ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import type { ManagedUser } from "../types";

interface OwnerPanelProps {
  isOpen: boolean;
}

export default function OwnerPanel({ isOpen }: OwnerPanelProps) {
  const [ownerSearches, setOwnerSearches] = useState<any[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const response = await fetch("/api/admin/users");
    if (response.ok) setUsers((await response.json()).users);
  };

  const loadAll = async () => { const r = await fetch("/api/admin/searches"); if (r.ok) setOwnerSearches((await r.json()).searches); };
  useEffect(() => { if (isOpen) { void load(); void loadAll(); } }, [isOpen]);
  if (!isOpen) return null;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, temporaryPassword }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setError(data.error || "Could not create account.");
    setEmail("");
    setTemporaryPassword("");
    await load();
  };

  const setActive = async (user: ManagedUser, isActive: boolean) => {
    await fetch(`/api/admin/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
    await load();
  };

  const remove = async (user: ManagedUser) => {
    if (!window.confirm(`Delete ${user.email} and all their saved searches?`)) return;
    await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    await load();
  };

  return (
    <section className="bg-[#15181E] border border-slate-800 rounded-lg p-5 space-y-4">
      <div className="flex items-center gap-2 text-white font-semibold text-sm uppercase tracking-wider"><ShieldCheck className="w-4 h-4 text-blue-500" /> Owner access</div>
      <form onSubmit={create} className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="new.user@example.com" className="bg-[#0A0B0E] border border-slate-700 rounded p-2 text-xs" />
        <input required minLength={12} type="password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} placeholder="Temporary password (12+)" className="bg-[#0A0B0E] border border-slate-700 rounded p-2 text-xs" />
        <button className="rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"><UserPlus className="w-3.5 h-3.5" /> Create account</button>
      </form>
      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
      <div className="divide-y divide-slate-800 border border-slate-800 rounded overflow-hidden">
        {users.map((user) => (
          <div key={user.id} className="p-3 flex flex-wrap gap-3 items-center justify-between text-xs bg-[#0A0B0E]">
            <div><span className="font-semibold text-slate-200">{user.email}</span> <span className="ml-2 text-slate-500 font-mono">{user.role} · {user.is_active ? "active" : "disabled"}{user.must_change_password ? " · password change required" : ""}</span></div>
            {user.role === "user" && <div className="flex gap-2"><button onClick={() => setActive(user, !Boolean(user.is_active))} className="text-amber-400 hover:text-amber-300">{user.is_active ? "Disable" : "Enable"}</button><button onClick={() => remove(user)} className="text-rose-400 hover:text-rose-300 flex gap-1 items-center"><UserMinus className="w-3 h-3" /> Delete</button></div>}
          </div>
        ))}
      </div>
      <div className="pt-2">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Все поиски (только просмотр)</div>
        <div className="divide-y divide-slate-800 border border-slate-800 rounded overflow-hidden max-h-64 overflow-auto">
          {ownerSearches.length === 0 ? <div className="p-3 text-xs text-slate-500">Нет поисков</div> : ownerSearches.map((r:any)=>(<div key={r.id} className="p-2 flex justify-between text-[11px] bg-[#0A0B0E]"><span className="truncate max-w-[60%]">{r.email} · {r.query}</span><span className="text-slate-500">{r.source} · {r.status} · {r.result_count} · {String(r.created_at).slice(0,16)}</span></div>))}
        </div>
      </div>
    </section>
  );
}
