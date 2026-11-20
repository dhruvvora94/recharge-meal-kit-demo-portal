import { Form, Link, NavLink } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

export function WaldenLogo({ className = "h-12" }: { className?: string }) {
  return <img src="/walden-logo.svg" alt="Walden Local" className={className} />;
}

function Chevron({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

function MyWaldenMenu({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const item = "block px-4 py-2.5 text-[15px] text-ink hover:bg-cream";
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 font-semibold hover:text-gold-light"
        aria-expanded={open}
      >
        My Walden <Chevron />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-3 w-56 overflow-hidden rounded-md bg-white py-1 shadow-modal animate-fade-in">
          <Link to={`/${customerId}`} className={item} onClick={() => setOpen(false)}>Upcoming Orders</Link>
          <Link to={`/${customerId}/plans`} className={item} onClick={() => setOpen(false)}>Your Plans</Link>
          <Link to={`/${customerId}/orders`} className={item} onClick={() => setOpen(false)}>Order History</Link>
          <Link to={`/${customerId}/account`} className={item} onClick={() => setOpen(false)}>Account</Link>
          <Form method="post" action="/logout" className="border-t border-line">
            <button type="submit" className={`${item} w-full text-left`}>Log Out</button>
          </Form>
        </div>
      )}
    </div>
  );
}

export function SiteHeader({ customerId, active }: { customerId?: string; active?: "shop" }) {
  return (
    <header>
      <div className="bg-gold-light py-1 text-center text-[13px] font-medium text-ink">
        Recharge demo environment
      </div>
      <div className="bg-forest text-white">
        <div className="relative mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-7">
          <nav className="hidden items-center gap-6 text-[15px] font-semibold md:flex">
            {customerId ? (
              <NavLink
                to={`/${customerId}/shop`}
                className={active === "shop" ? "text-gold-light underline decoration-2 underline-offset-[10px]" : "hover:text-gold-light"}
              >
                Shop
              </NavLink>
            ) : (
              <span>Shop</span>
            )}
            <span className="flex items-center gap-1.5">Learn <Chevron /></span>
            <span>2026 Thanksgiving</span>
          </nav>
          <Link to={customerId ? `/${customerId}` : "/"} className="absolute left-1/2 -translate-x-1/2">
            <WaldenLogo className="h-[52px]" />
          </Link>
          <div className="ml-auto flex items-center gap-5 text-[15px] font-semibold">
            <span className="hidden items-center gap-2 sm:flex">
              <span className="rounded-full bg-gold px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-wide text-forest">New</span>
              Refer &amp; Earn
            </span>
            {customerId && <MyWaldenMenu customerId={customerId} />}
          </div>
        </div>
      </div>
    </header>
  );
}

function SocialIcon({ d }: { d: string }) {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-10 bg-forest text-white">
      <div className="mx-auto max-w-[1440px] px-16 pt-14 pb-10">
        <div className="relative flex items-center justify-between border-b border-white/15 pb-10">
          <nav className="flex gap-6 text-[15px] font-semibold">
            <span>How It Works</span>
            <span>Meat &amp; Provisions</span>
            <span>Our Story</span>
          </nav>
          <div className="absolute left-1/2 -translate-x-1/2">
            <WaldenLogo className="h-[72px]" />
          </div>
          <div className="flex items-center gap-16 text-[15px] font-semibold">
            <span>Follow us on</span>
            <div className="flex gap-4 text-[#A9B1A1]">
              <SocialIcon d="M14 8h3V4h-3c-2.8 0-4 1.8-4 4v2H7v4h3v8h4v-8h3l1-4h-4V8.5c0-.3.2-.5.5-.5z" />
              <SocialIcon d="M12 7a5 5 0 100 10 5 5 0 000-10zm0 8.2a3.2 3.2 0 110-6.4 3.2 3.2 0 010 6.4zM17.3 5.5a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4zM12 3c-2.4 0-2.7 0-3.7.1C5.6 3.2 3.2 5.6 3.1 8.3 3 9.3 3 9.6 3 12s0 2.7.1 3.7c.1 2.7 2.5 5.1 5.2 5.2 1 .1 1.3.1 3.7.1s2.7 0 3.7-.1c2.7-.1 5.1-2.5 5.2-5.2.1-1 .1-1.3.1-3.7s0-2.7-.1-3.7c-.1-2.7-2.5-5.1-5.2-5.2C14.7 3 14.4 3 12 3z" />
              <SocialIcon d="M5 9h3v11H5zM6.5 4a1.8 1.8 0 110 3.6 1.8 1.8 0 010-3.6zM10 9h2.9v1.5c.4-.8 1.4-1.7 3-1.7 3.1 0 3.6 2 3.6 4.7V20h-3v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9V20h-3z" />
            </div>
          </div>
        </div>
        <div className="flex items-start justify-between pt-12">
          <div>
            <p className="text-[15px] font-semibold">Sign up for emails to get the latest news and offers.</p>
            <div className="mt-5 flex items-center gap-2.5">
              <input
                className="h-12 w-[284px] rounded-full bg-cream-light px-4 text-[13px] text-ink placeholder:text-ink/60 outline-none"
                placeholder="Enter your email"
                aria-label="Email"
              />
              <button type="button" className="h-12 rounded-full bg-gold px-7 text-[13px] font-bold uppercase text-forest">
                Sign Up
              </button>
            </div>
          </div>
          <div className="flex gap-28">
            <ul className="space-y-3 text-[11px] font-bold uppercase tracking-wider">
              <li>Butcher Shop</li>
              <li>Blog</li>
              <li>FAQs</li>
              <li>Contact Us</li>
              <li>Careers</li>
            </ul>
            <div className="flex flex-col items-center text-[10px] font-semibold">
              <span>Certified</span>
              <span className="mt-1 flex h-11 w-11 items-center justify-center rounded-full border-2 border-white text-2xl font-bold">B</span>
              <span className="mt-1 border-t-2 border-white pt-0.5 text-[8px]">Corporation</span>
            </div>
          </div>
        </div>
        <div className="mt-14 flex items-center justify-between text-[11px] font-semibold">
          <span>© {new Date().getFullYear()} Walden Local Meat Co., All rights reserved.</span>
          <span className="flex gap-6">
            <span>Privacy Policy</span>
            <span>Accessibility</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

export function PageShell({
  customerId,
  active,
  children,
  tone = "white",
}: {
  customerId?: string;
  active?: "shop";
  children: React.ReactNode;
  tone?: "white" | "cream";
}) {
  return (
    <div className={`flex min-h-screen flex-col ${tone === "cream" ? "bg-cream" : "bg-white"}`}>
      <SiteHeader customerId={customerId} active={active} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
