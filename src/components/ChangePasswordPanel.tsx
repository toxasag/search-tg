import { FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";

interface ChangePasswordPanelProps {
  required: boolean;
  onChanged: () => void;
}

export default function ChangePasswordPanel({ required, onChanged }: ChangePasswordPanelProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [isOpen, setIsOpen] = useState(required);

  if (!isOpen) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return setError(data.error || "Password could not be updated.");
    }
    onChanged();
    setIsOpen(false);
  };

  return (
    <section className="bg-[#15181E] border border-amber-900/50 rounded-lg p-5 space-y-4">
      <div className="flex gap-2 items-center text-white font-semibold text-sm"><KeyRound className="w-4 h-4 text-amber-400" /> {required ? "Set your personal password" : "Change password"}</div>
      {required && <p className="text-xs text-amber-200/80">Your account has a temporary password. Change it before continuing.</p>}
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" className="bg-[#0A0B0E] border border-slate-700 rounded p-2 text-xs" />
        <input required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password (12+)" className="bg-[#0A0B0E] border border-slate-700 rounded p-2 text-xs" />
        <button className="rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold">Save password</button>
      </form>
      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
    </section>
  );
}
