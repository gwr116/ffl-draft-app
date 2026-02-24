"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [msg, setMsg] = useState<string | null>(null);

  async function sendCode() {
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // This makes Supabase send an OTP code email.
        shouldCreateUser: true,
      },
    });
    if (error) setMsg(error.message);
    else {
      setStep("code");
      setMsg("Code sent. Enter the 6-digit code from your email.");
    }
  }

  async function verifyCode() {
    setMsg(null);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (error) setMsg(error.message);
    else window.location.href = "/";
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Login</h1>

        {step === "email" ? (
          <>
            <p className="text-sm text-gray-600">We’ll email you a one-time code.</p>
            <input
              className="w-full border rounded px-3 py-2"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              className="w-full bg-black text-white rounded px-3 py-2 disabled:opacity-50"
              onClick={sendCode}
              disabled={!email}
            >
              Send code
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600">Enter the 6-digit code we emailed you.</p>
            <input
              className="w-full border rounded px-3 py-2"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
            />
            <button
              className="w-full bg-black text-white rounded px-3 py-2 disabled:opacity-50"
              onClick={verifyCode}
              disabled={!email || code.length < 6}
            >
              Verify code
            </button>
            <button className="w-full border rounded px-3 py-2" onClick={() => setStep("email")}>
              Back
            </button>
          </>
        )}

        {msg && <p className="text-sm">{msg}</p>}
      </div>
    </div>
  );
}
