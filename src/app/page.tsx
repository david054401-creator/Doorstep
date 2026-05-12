'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, ChevronDown, ChevronUp, Star,
  DollarSign, FileText, Wrench, Bell, Shield, ArrowRight,
  Building2, MessageSquare, BarChart3, Camera
} from 'lucide-react';

/* ─── Brand tokens ─── */
const C = {
  primary: '#C75D3D',
  primaryHover: '#A84A2E',
  primary400: '#E07A5A',
  primary100: '#F4C9B8',
  primary50: '#FDF1EB',
  ink: '#1A1714',
  charcoal: '#3D362F',
  stone: '#6B6058',
  mist: '#A8A099',
  linen: '#E8E3DC',
  cream: '#F5F1EA',
  white: '#FFFFFF',
  moss: '#5C8A3A',
  mossBg: '#EEF4E5',
};

const navLinkStyle: React.CSSProperties = { color: C.stone, textDecoration: 'none', fontSize: 15, fontWeight: 500 };

function Wordmark() {
  return (
    <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, color: C.primary, fontSize: 24, letterSpacing: '-0.01em' }}>
      Doorstep
    </span>
  );
}

const faqs = [
  { q: 'Do my tenants need to download an app?', a: 'Nope. They get a text message with a link. They pay in their browser. No app, no account, no hassle for them.' },
  { q: 'How does Doorstep collect rent?', a: 'We send your tenants a payment link via text on the day rent is due. They pay by bank transfer (free) or card (2.9% fee, paid by them). Money lands in your account in 2 business days.' },
  { q: 'Is my financial data safe?', a: 'Bank-level 256-bit encryption. We connect to your bank through Plaid — the same technology used by Chase, Wells Fargo, and thousands of other banks. We never store your banking credentials.' },
  { q: 'Can I track cash or check payments?', a: 'Yes. You can manually record any payment — cash, check, Venmo, whatever. It all shows up in your records and year-end summary.' },
  { q: 'What happens at tax time?', a: 'We generate a ready-to-file Schedule E report with all your income and expenses pre-categorized. Hand it to your accountant or use it yourself. Pro and Plus plans include this.' },
  { q: 'Can I add my spouse or accountant?', a: 'Yes. The Pro plan lets you add co-owners and give your accountant read-only access to your records.' },
  { q: 'What if my tenant is late?', a: "You set it up once and we handle it. Automatic late fee reminders go out after the grace period. You can also send a manual reminder with one tap." },
  { q: 'Can I try it before paying?', a: "Yes — free forever for 1 property. No credit card needed to start. Add more properties when you're ready." },
];

const plans = [
  {
    name: 'Free', price: 0, unit: 'forever', desc: '1 property, 1 tenant', popular: false,
    features: ['1 unit, 1 tenant', 'Rent reminders via SMS', 'Expense tracking', 'Basic dashboard'],
    cta: 'Start free',
  },
  {
    name: 'Starter', price: 12, unit: '/mo per unit', desc: 'Up to 5 units', popular: true,
    features: ['Online rent collection (ACH free, card 2.9%)', 'Auto receipt scanning', 'Lease storage', 'Maintenance request portal', 'Tenant communication log', 'Monthly summary email'],
    cta: 'Start free trial',
  },
  {
    name: 'Pro', price: 24, unit: '/mo per unit', desc: '6–25 units', popular: false,
    features: ['Everything in Starter', 'Tax-ready year-end package', 'Vendor management', 'Multiple bank accounts', 'Co-owner & accountant access', 'Late fee automation', 'Vacancy listing syndication'],
    cta: 'Get started',
  },
];

const testimonials = [
  { name: 'Linda Morrison', location: 'Tucson, AZ', units: '2 units', quote: "I'm not a tech person at all. This is the first software that didn't make me cry. My tenant pays on time now because she gets a text reminder. I don't have to do anything.", initials: 'LM', bg: '#F4C9B8' },
  { name: 'Mike Reyes', location: 'Phoenix, AZ', units: '3 units', quote: "I'm a plumber. I bought three rental houses over the years. I was doing everything in a notebook. Doorstep pays for itself in time saved every single month.", initials: 'MR', bg: '#EEF4E5' },
  { name: 'Sarah Chen', location: 'Denver, CO', units: '1 unit', quote: "I accidentally became a landlord when I moved. Doorstep helped me set up everything in 20 minutes. My accountant loves the year-end report.", initials: 'SC', bg: '#E5EEF5' },
];

function PhoneMockup() {
  return (
    <div style={{ position: 'relative', width: 260, margin: '0 auto' }}>
      <div style={{ background: C.ink, borderRadius: 40, padding: '12px 8px', boxShadow: '0 24px 64px rgba(26,23,20,0.18), 0 8px 24px rgba(26,23,20,0.1)' }}>
        <div style={{ background: C.cream, borderRadius: 32, overflow: 'hidden' }}>
          <div style={{ background: C.white, padding: '8px 20px 4px', display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: C.ink }}>
            <span>9:41</span><span>5G ▮</span>
          </div>
          <div style={{ background: C.white, padding: '8px 16px 12px', borderBottom: `1px solid ${C.linen}` }}>
            <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, color: C.primary, fontSize: 18 }}>Doorstep</span>
          </div>
          <div style={{ background: C.white, margin: 12, borderRadius: 16, border: `1px solid ${C.linen}`, padding: 16 }}>
            <div style={{ fontSize: 11, color: C.stone, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>COMING IN THIS MONTH</div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 32, fontWeight: 500, color: C.ink, lineHeight: 1 }}>$2,400</div>
            <div style={{ fontSize: 12, color: C.stone, marginTop: 4 }}>$1,800 received · $600 due</div>
            <div style={{ marginTop: 8, background: C.mossBg, color: C.moss, borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 600, display: 'inline-block' }}>On track ✓</div>
          </div>
          <div style={{ padding: '0 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {[['📥', 'Record payment'], ['💸', 'Log expense'], ['🔧', 'Maintenance'], ['📋', 'Message']].map(([icon, label]) => (
              <div key={label} style={{ background: C.white, borderRadius: 12, padding: '10px 8px', border: `1px solid ${C.linen}`, textAlign: 'center' }}>
                <div style={{ fontSize: 18 }}>{icon}</div>
                <div style={{ fontSize: 10, color: C.charcoal, fontWeight: 500, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '0 12px 16px' }}>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 14, fontWeight: 500, color: C.ink, marginBottom: 8 }}>What&apos;s happening</div>
            {[
              { dot: C.moss, text: 'Sarah paid March rent', sub: '2h ago', amt: '+$1,200' },
              { dot: '#D4923B', text: 'Leaky faucet request', sub: 'yesterday', amt: 'Open' },
            ].map(item => (
              <div key={item.text} style={{ background: C.white, borderRadius: 10, padding: '8px 10px', marginBottom: 6, border: `1px solid ${C.linen}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.dot, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.ink }}>{item.text}</div>
                  <div style={{ fontSize: 10, color: C.stone }}>{item.sub}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.charcoal }}>{item.amt}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [email, setEmail] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [billingAnnual, setBillingAnnual] = useState(false);

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', background: C.cream, color: C.ink, overflowX: 'hidden' }}>

      {/* NAV */}
      <nav style={{ background: C.white, borderBottom: `1px solid ${C.linen}`, padding: '0 24px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <Wordmark />
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="#pricing" style={navLinkStyle}>Pricing</Link>
          <Link href="/dashboard" style={navLinkStyle}>See demo →</Link>
          <Link href="/onboarding" style={{ background: C.primary, color: C.white, borderRadius: 10, padding: '9px 20px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            Start free
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ background: C.cream, padding: '80px 24px 64px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -80, right: -80, width: 400, height: 400, borderRadius: '50%', background: C.primary100, opacity: 0.5, filter: 'blur(60px)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -40, left: -60, width: 300, height: 300, borderRadius: '50%', background: C.primary50, opacity: 0.8, filter: 'blur(40px)', pointerEvents: 'none' }} />
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 48, alignItems: 'center', position: 'relative' }}>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }}>
            <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 'clamp(36px, 6vw, 56px)', lineHeight: 1.1, color: C.ink, marginBottom: 20, letterSpacing: '-0.02em' }}>
              Renting out a place?<br />
              <span style={{ color: C.primary }}>We handle the boring parts.</span>
            </h1>
            <p style={{ fontSize: 18, lineHeight: '28px', color: C.charcoal, marginBottom: 32, maxWidth: 480 }}>
              Doorstep collects rent, tracks expenses, and gets you ready for taxes. No spreadsheets. No headaches.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <input
                type="email"
                placeholder="Your email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ flex: 1, minWidth: 220, background: C.white, border: `1.5px solid ${C.linen}`, borderRadius: 12, padding: '14px 16px', fontSize: 16, color: C.ink, outline: 'none', fontFamily: 'Inter, sans-serif' }}
              />
              <Link href="/onboarding" style={{ background: C.primary, color: C.white, borderRadius: 12, padding: '14px 28px', fontSize: 16, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                Start free <ArrowRight size={16} />
              </Link>
            </div>
            <p style={{ fontSize: 14, color: C.stone }}>No credit card needed · Free forever for 1 property</p>
            <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
              {[
                { icon: <Shield size={16} color={C.moss} />, text: 'Bank-level encryption' },
                { icon: <Star size={16} color="#D4923B" fill="#D4923B" />, text: '4.9★ on App Store' },
                { icon: <CheckCircle2 size={16} color={C.moss} />, text: '12,000+ landlords' },
              ].map(t => (
                <div key={t.text} style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.stone, fontSize: 14 }}>
                  {t.icon}<span>{t.text}</span>
                </div>
              ))}
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2 }} className="animate-float" style={{ display: 'flex', justifyContent: 'center' }}>
            <PhoneMockup />
          </motion.div>
        </div>
      </section>

      {/* PROBLEM */}
      <section style={{ background: C.white, padding: '80px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
            style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 'clamp(28px, 4vw, 40px)', color: C.ink, textAlign: 'center', marginBottom: 48 }}>
            If this sounds like you...
          </motion.h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
            {[
              { icon: MessageSquare, color: '#FBF1E0', iconColor: '#D4923B', title: 'You text your tenant for rent every month', desc: "You send the same 'Hey, rent is due...' text on the 1st. Sometimes they forget. Sometimes you forget." },
              { icon: Camera, color: C.primary50, iconColor: C.primary, title: 'Your receipts live in a shoebox', desc: "Repairs, insurance, supplies — it's all in a pile somewhere. Tax time is a nightmare of digging through emails." },
              { icon: FileText, color: '#EEF4E5', iconColor: C.moss, title: 'Tax time gives you nightmares', desc: "Every April you scramble to figure out what you spent and what you made. Your accountant charges you extra." },
            ].map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}
                style={{ background: item.color, borderRadius: 20, padding: '28px 24px', border: `1px solid ${C.linen}` }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <item.icon size={24} color={item.iconColor} strokeWidth={1.75} />
                </div>
                <h3 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 20, color: C.ink, marginBottom: 8, lineHeight: '28px' }}>{item.title}</h3>
                <p style={{ fontSize: 15, color: C.stone, lineHeight: '22px' }}>{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SOLUTION */}
      <section style={{ background: C.cream, padding: '80px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
            <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 'clamp(28px, 4vw, 40px)', color: C.ink, textAlign: 'center', marginBottom: 12 }}>
              Here&apos;s what changes with Doorstep
            </h2>
            <p style={{ textAlign: 'center', color: C.stone, fontSize: 18, marginBottom: 56, maxWidth: 560, margin: '0 auto 56px' }}>
              Four things. That&apos;s it. These four things will change how your rental business works.
            </p>
          </motion.div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
            {[
              { icon: DollarSign, title: 'Rent collects itself', desc: "We text your tenants on rent day. They pay. You get notified. Money in your account in 2 days. No chasing.", color: '#EEF4E5', iconColor: C.moss },
              { icon: Camera, title: 'Snap a receipt, done', desc: "Take a photo of any receipt. We read it, categorize it, and file it. Your shoebox is officially retired.", color: C.primary50, iconColor: C.primary },
              { icon: BarChart3, title: 'Tax time is easy', desc: "Everything you need for Schedule E is waiting in Doorstep at the end of the year. Pre-organized, ready to hand over.", color: '#E5EEF5', iconColor: '#4A7C9E' },
              { icon: Wrench, title: 'Maintenance tracked', desc: "Tenants submit requests with photos. You assign vendors. Everything is logged. No more 'I told you last Tuesday.'", color: '#FBF1E0', iconColor: '#D4923B' },
            ].map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}
                style={{ background: C.white, borderRadius: 20, padding: '28px 24px', border: `1px solid ${C.linen}`, boxShadow: '0 4px 12px rgba(26,23,20,0.06)' }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <item.icon size={24} color={item.iconColor} strokeWidth={1.75} />
                </div>
                <h3 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 20, color: C.ink, marginBottom: 8 }}>{item.title}</h3>
                <p style={{ fontSize: 15, color: C.stone, lineHeight: '22px' }}>{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ background: C.white, padding: '80px 24px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 'clamp(28px, 4vw, 40px)', color: C.ink, textAlign: 'center', marginBottom: 48 }}>
            Set up in 4 minutes flat
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { step: '1', title: 'Add your property', desc: "Enter the address. Tell us who lives there. That's it." },
              { step: '2', title: 'Connect your bank', desc: "Securely link where rent should land. Takes 60 seconds through Plaid." },
              { step: '3', title: 'We text your tenant', desc: "They get a payment link. They pay. You get notified." },
              { step: '4', title: 'Everything tracked automatically', desc: "Payments, expenses, maintenance — all organized for you." },
            ].map((item, i) => (
              <motion.div key={item.step} initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}
                style={{ display: 'flex', gap: 20, paddingBottom: 32, position: 'relative' }}>
                {i < 3 && <div style={{ position: 'absolute', left: 20, top: 44, bottom: 0, width: 2, background: C.linen }} />}
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: C.primary, color: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0, zIndex: 1 }}>
                  {item.step}
                </div>
                <div style={{ paddingTop: 8 }}>
                  <h3 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 20, color: C.ink, marginBottom: 6 }}>{item.title}</h3>
                  <p style={{ fontSize: 16, color: C.stone, lineHeight: '24px' }}>{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section style={{ background: C.cream, padding: '80px 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 'clamp(28px, 4vw, 40px)', color: C.ink, textAlign: 'center', marginBottom: 48 }}>
            Real landlords. Real results.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            {testimonials.map((t, i) => (
              <motion.div key={t.name} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}
                style={{ background: C.white, borderRadius: 20, padding: '28px 24px', border: `1px solid ${C.linen}`, boxShadow: '0 4px 12px rgba(26,23,20,0.06)' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                  {[1,2,3,4,5].map(s => <Star key={s} size={16} color="#D4923B" fill="#D4923B" />)}
                </div>
                <p style={{ fontSize: 16, color: C.charcoal, lineHeight: '26px', marginBottom: 20, fontStyle: 'italic' }}>&ldquo;{t.quote}&rdquo;</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, color: C.charcoal, fontSize: 14 }}>{t.initials}</div>
                  <div>
                    <div style={{ fontWeight: 600, color: C.ink, fontSize: 15 }}>{t.name}</div>
                    <div style={{ fontSize: 13, color: C.stone }}>{t.location} · {t.units}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ background: C.white, padding: '80px 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 'clamp(28px, 4vw, 40px)', color: C.ink, textAlign: 'center', marginBottom: 12 }}>Simple pricing</h2>
          <p style={{ textAlign: 'center', color: C.stone, fontSize: 17, marginBottom: 32 }}>Start free. Pay only when you grow.</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 40 }}>
            <span style={{ fontSize: 15, color: billingAnnual ? C.mist : C.ink, fontWeight: 500 }}>Monthly</span>
            <button onClick={() => setBillingAnnual(b => !b)} style={{ width: 52, height: 28, borderRadius: 999, background: billingAnnual ? C.primary : C.linen, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 200ms' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: C.white, position: 'absolute', top: 3, left: billingAnnual ? 27 : 3, transition: 'left 200ms', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
            </button>
            <span style={{ fontSize: 15, color: billingAnnual ? C.ink : C.mist, fontWeight: 500 }}>Annual <span style={{ background: C.mossBg, color: C.moss, borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>Save 20%</span></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            {plans.map((plan, i) => (
              <motion.div key={plan.name} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}
                style={{ background: plan.popular ? C.primary : C.white, borderRadius: 20, padding: '28px 24px', border: plan.popular ? 'none' : `1px solid ${C.linen}`, boxShadow: plan.popular ? '0 12px 32px rgba(199,93,61,0.2)' : '0 4px 12px rgba(26,23,20,0.06)', position: 'relative' }}>
                {plan.popular && (
                  <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: C.white, borderRadius: 999, padding: '4px 14px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Most popular</div>
                )}
                <div style={{ fontSize: 14, fontWeight: 600, color: plan.popular ? 'rgba(255,255,255,0.7)' : C.stone, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{plan.name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'Fraunces, serif', fontSize: 40, fontWeight: 500, color: plan.popular ? C.white : C.ink }}>
                    {plan.price === 0 ? 'Free' : `$${billingAnnual ? Math.round(plan.price * 0.8) : plan.price}`}
                  </span>
                  {plan.price > 0 && <span style={{ fontSize: 14, color: plan.popular ? 'rgba(255,255,255,0.7)' : C.stone }}>{plan.unit}</span>}
                </div>
                <div style={{ fontSize: 14, color: plan.popular ? 'rgba(255,255,255,0.7)' : C.stone, marginBottom: 24 }}>{plan.desc}</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: plan.popular ? 'rgba(255,255,255,0.9)' : C.charcoal }}>
                      <CheckCircle2 size={16} color={plan.popular ? 'rgba(255,255,255,0.7)' : C.moss} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />{f}
                    </li>
                  ))}
                </ul>
                <Link href="/onboarding" style={{ display: 'block', textAlign: 'center', padding: '13px 24px', borderRadius: 12, fontWeight: 600, fontSize: 15, textDecoration: 'none', background: plan.popular ? C.white : C.primary, color: plan.popular ? C.primary : C.white }}>
                  {plan.cta}
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: C.cream, padding: '80px 24px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 'clamp(28px, 4vw, 36px)', color: C.ink, textAlign: 'center', marginBottom: 48 }}>
            Questions? We&apos;ve got answers.
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {faqs.map((faq, i) => (
              <div key={i} style={{ background: C.white, borderRadius: 16, border: `1px solid ${C.linen}`, overflow: 'hidden' }}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{ width: '100%', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', gap: 16, textAlign: 'left' }}>
                  <span style={{ fontWeight: 600, color: C.ink, fontSize: 16, lineHeight: '24px' }}>{faq.q}</span>
                  {openFaq === i ? <ChevronUp size={20} color={C.primary} /> : <ChevronDown size={20} color={C.stone} />}
                </button>
                <AnimatePresence>
                  {openFaq === i && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                      <div style={{ padding: '16px 24px 20px', fontSize: 16, color: C.stone, lineHeight: '26px', borderTop: `1px solid ${C.linen}` }}>{faq.a}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: C.primary, padding: '80px 24px', textAlign: 'center' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 'clamp(28px, 4vw, 44px)', color: C.white, marginBottom: 16 }}>
            Ready to stop chasing rent?
          </h2>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.8)', marginBottom: 40, maxWidth: 480, margin: '0 auto 40px' }}>
            Join 12,000+ landlords who run their rentals with Doorstep. Takes 4 minutes to get started.
          </p>
          <Link href="/onboarding" style={{ background: C.white, color: C.primary, borderRadius: 12, padding: '16px 36px', fontSize: 18, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Start free — no credit card <ArrowRight size={18} />
          </Link>
        </motion.div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: C.ink, color: 'rgba(255,255,255,0.6)', padding: '48px 24px 32px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 32, marginBottom: 40 }}>
            <div>
              <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, color: C.white, fontSize: 22 }}>Doorstep</span>
              <p style={{ fontSize: 14, marginTop: 8, maxWidth: 260, lineHeight: '22px' }}>Run your rentals like a pro. Without becoming one.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 48px' }}>
              {[
                { label: 'Product', links: ['Features', 'Pricing', 'For Tenants', 'Mobile App'] },
                { label: 'Company', links: ['About', 'Blog', 'Privacy', 'Terms'] },
              ].map(col => (
                <div key={col.label}>
                  <div style={{ color: C.white, fontWeight: 600, fontSize: 14, marginBottom: 16 }}>{col.label}</div>
                  {col.links.map(l => (
                    <div key={l} style={{ marginBottom: 12 }}>
                      <a href="#" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none', fontSize: 14 }}>{l}</a>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span style={{ fontSize: 13 }}>© 2024 Doorstep. All rights reserved.</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <Shield size={14} color={C.moss} />
              <span>256-bit encryption · SOC 2 Type II · FDIC insured transfers</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
