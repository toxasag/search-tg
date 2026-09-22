import { FormEvent, useState } from "react";
import { ArrowRight, KeyRound, ShieldAlert } from "lucide-react";
import type { CurrentUser } from "../types";

interface AuthScreenProps {
  needsBootstrap: boolean;
  onAuthenticated: (user: CurrentUser) => void;
}

export default function AuthScreen({ needsBootstrap, onAuthenticated }: AuthScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Sign-in failed.");
      onAuthenticated(data.user);
    } catch (reason: any) {
      setError(reason.message || "Sign-in failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitBootstrap = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Owner creation failed.");
      onAuthenticated(data.user);
    } catch (reason: any) {
      setError(reason.message || "Owner creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen w-full bg-[#0A0B0E] flex items-center justify-center p-5 text-slate-300">
      <section className="w-full max-w-md border border-slate-800 rounded-lg overflow-hidden bg-[#15181E] shadow-2xl shadow-black/40">
        <div className="p-6 border-b border-slate-800 bg-[#0F1117]">
          <div className="w-10 h-10 rounded bg-blue-600 flex items-center justify-center text-white font-bold mb-4 shadow-[0_0_16px_rgba(37,99,235,0.35)]">S</div>
          <h1 className="text-xl text-white font-bold tracking-tight">
            {needsBootstrap ? "Initial Owner Setup" : "Telegram Finder Access"}
          </h1>
          <p className="text-xs text-slate-500 font-mono mt-1">
            {needsBootstrap ? "Create the primary administrator account for this instance." : "Your searches, lists, and exports stay private."}
          </p>
        </div>
        {needsBootstrap ? (
          <form className="p-6 space-y-4" onSubmit={submitBootstrap}>
            <div className="flex items-center gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>No owner account exists yet. Create your administrator credentials below:</span>
            </div>
            <label className="block text-xs text-slate-500 uppercase tracking-wider font-mono">Owner Email
              <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" className="mt-1.5 w-full rounded bg-[#0A0B0E] border border-slate-700 p-2.5 text-slate-200 normal-case tracking-normal focus:outline-none focus:border-blue-500" />
            </label>
            <label className="block text-xs text-slate-500 uppercase tracking-wider font-mono">Owner Password
              <input required type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" className="mt-1.5 w-full rounded bg-[#0A0B0E] border border-slate-700 p-2.5 text-slate-200 normal-case tracking-normal focus:outline-none focus:border-blue-500" />
            </label>
            {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
            <button disabled={isSubmitting} className="w-full py-2.5 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 text-white text-xs font-semibold uppercase tracking-wider flex justify-center items-center gap-2">
              <KeyRound className="w-3.5 h-3.5" /> {isSubmitting ? "Creating owner…" : "Create Owner & Sign In"} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <form className="p-6 space-y-4" onSubmit={submit}>
            <label className="block text-xs text-slate-500 uppercase tracking-wider font-mono">Email
              <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded bg-[#0A0B0E] border border-slate-700 p-2.5 text-slate-200 normal-case tracking-normal focus:outline-none focus:border-blue-500" />
            </label>
            <label className="block text-xs text-slate-500 uppercase tracking-wider font-mono">Password
              <input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded bg-[#0A0B0E] border border-slate-700 p-2.5 text-slate-200 normal-case tracking-normal focus:outline-none focus:border-blue-500" />
            </label>
            {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
            <button disabled={isSubmitting} className="w-full py-2.5 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 text-white text-xs font-semibold uppercase tracking-wider flex justify-center items-center gap-2">
              <KeyRound className="w-3.5 h-3.5" /> {isSubmitting ? "Signing in…" : "Sign in"} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
