import LoginForm from "@/components/login-form";
import ThemeToggle from "@/components/theme-toggle";
import { isLoginConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <main className="login-shell"><section className="login-card"><div className="login-head"><a className="brand" href="/"><span className="brand-mark">↗</span><span>stride<span className="lime">.</span></span></a><ThemeToggle/></div><div><div className="eyebrow">PRIVATE RUNNING DASHBOARD</div><h1>Welcome back</h1><p className="muted">Sign in to view your running log and training plan.</p></div>{isLoginConfigured() ? <LoginForm destination={destination}/> : <p className="login-warning">Login is not configured yet. The site owner needs to add the Stride login settings in the hosting dashboard.</p>}</section></main>;
}
