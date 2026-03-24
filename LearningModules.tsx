import { useState } from "react";
import {
  LayoutDashboard,
  Eye,
  FileText,
  Settings,
  Shield,
  Pencil,
  Cloud,
  Database,
  Menu,
  Link2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";

const modules = [
  {
    id: 1,
    topics: 3,
    title: "Foundations of Transformers",
    description:
      "An introductory module covering the core ideas behind transformers, including sequence modeling, attention, tokens, embeddings, and why transformers became central to modern AI.",
    queuedSync: true,
    fallback: true,
    connected: false,
  },
  {
    id: 2,
    topics: 3,
    title: "Mathematical Foundations of Transformers",
    description:
      "A mathematically focused module covering the linear algebra, probability, optimization, and matrix operations that support transformer models.",
    queuedSync: true,
    fallback: true,
    connected: false,
  },
  {
    id: 3,
    topics: 3,
    title: "Foundations of Transformer Architecture",
    description:
      "A structural module explaining the internal components of transformer systems, including attention blocks, feed-forward layers, residual connections, normalization, and multi-head mechanisms.",
    queuedSync: false,
    fallback: true,
    connected: true,
  },
  {
    id: 4,
    topics: 4,
    title: "Attention Mechanisms Deep Dive",
    description:
      "An exploration of self-attention, cross-attention, and multi-head attention mechanisms with practical examples and mathematical derivations.",
    queuedSync: false,
    fallback: false,
    connected: true,
  },
  {
    id: 5,
    topics: 3,
    title: "Training Transformers at Scale",
    description:
      "Covers distributed training techniques, gradient checkpointing, mixed precision, and data pipeline optimization for large-scale transformer training.",
    queuedSync: false,
    fallback: false,
    connected: false,
  },
  {
    id: 6,
    topics: 5,
    title: "Fine-Tuning and Adaptation",
    description:
      "Techniques for adapting pre-trained transformer models to specific domains, including LoRA, prefix tuning, and instruction fine-tuning approaches.",
    queuedSync: false,
    fallback: false,
    connected: true,
  },
];

const diagnostics = [
  {
    label: "LEARNING MODULES\nBACKEND STATUS",
    value: null,
    badge: "Sync backend ready",
    sub: "All required Learning Modules backend checks passed.",
    pass: null,
  },
  {
    label: "LAST CHECKED",
    value: "24/03/2026, 13:19:08",
    sub: "Updated automatically during Learning Modules refreshes.",
    pass: null,
    badge: null,
  },
  {
    label: "SELECT FROM\nPUBLIC.LEARNING_MODULES",
    value: null,
    pass: true,
    sub: "Module list sync. OK",
    badge: null,
  },
  {
    label: "SELECT FROM\nPUBLIC.LEARNING_MODULE_",
    value: null,
    pass: true,
    sub: "Topic list sync. OK",
    badge: null,
  },
  {
    label: "SELECT FROM\nPUBLIC.LEARNING_MODULE_CARDS",
    value: null,
    pass: true,
    sub: "Card content sync (optional; app can use bundled cards). OK",
    badge: null,
  },
];

const diagnostics2 = [
  {
    label: "EXECUTE\nPUBLIC.GET_LEARNING_MOD...",
    value: null,
    pass: true,
    sub: '"Show all users connected" live d...',
    badge: null,
  },
  {
    label: "SELECT OWN ROWS FROM\nPUBLIC.LEARNING_MODULE_CONNECTIONS",
    value: null,
    pass: true,
    sub: "Restore your module connections. OK",
    badge: null,
  },
];

const navItems = [
  { icon: LayoutDashboard, label: "Current Site", active: false },
  { icon: Eye, label: "Top Sites", active: false },
  { icon: FileText, label: "Learning Modules", active: true },
  { icon: Settings, label: "Settings", active: false },
  { icon: Shield, label: "Privacy Policy", active: false },
  { icon: Pencil, label: "Edit Profile", active: false },
  { icon: Cloud, label: "Supabase Configuration", active: false },
  { icon: Database, label: "Data Controls", active: false },
];

function ConnectMeLogo() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill="#1a1a2e" />
          <circle cx="10" cy="16" r="3" fill="#4f8ef7" />
          <circle cx="22" cy="10" r="3" fill="#4f8ef7" />
          <circle cx="22" cy="22" r="3" fill="#4f8ef7" />
          <line x1="13" y1="16" x2="19" y2="11" stroke="#4f8ef7" strokeWidth="1.5" />
          <line x1="13" y1="16" x2="19" y2="21" stroke="#4f8ef7" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}

function Sidebar({ expanded }: { expanded: boolean }) {
  return (
    <div
      className={`h-full border-r border-gray-200 bg-white flex flex-col transition-all duration-300 ${
        expanded ? "w-56" : "w-14"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-4 border-b border-gray-100">
        <ConnectMeLogo />
        {expanded && (
          <button className="text-gray-500 hover:text-gray-700">
            <Menu size={18} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-3 py-4 border-b border-gray-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
            CONNECT.ME DESKTOP WORKSPACE
          </p>
          <p className="text-xl font-bold text-gray-900 leading-tight">
            Welcome to your workspace.
          </p>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            Switch between focused workspace sections from the foldout rail without stacking every panel in the same scroll view.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-gray-700">Presence</span>
            <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <button className="mt-3 w-full border border-gray-300 rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Edit profile
          </button>
        </div>
      )}

      {expanded && (
        <div className="px-3 py-3 border-b border-gray-100">
          <p className="text-xs text-gray-500">Current synchronized site</p>
          <p className="text-sm font-bold text-gray-900">app.alignerr.com</p>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            Background-synced context stays visible while the extension continues tracking your active site state.
          </p>
        </div>
      )}

      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={`w-full flex items-center gap-3 px-2 py-2.5 rounded-lg text-sm transition-colors ${
              item.active
                ? "bg-blue-50 text-blue-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <item.icon size={18} className={item.active ? "text-blue-600" : "text-gray-500"} />
            {expanded && <span className="font-medium">{item.label}</span>}
          </button>
        ))}
      </nav>

      <div className="px-3 pb-4 pt-2 border-t border-gray-100">
        {expanded && (
          <div className="flex items-center gap-2 py-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
            <span className="text-sm text-gray-600">Workspace online</span>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-white text-xs font-bold">
            CM
          </div>
          {expanded && (
            <div className="flex-1">
              <p className="text-xs font-medium text-gray-700">Connected</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LearningModules() {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50 font-sans text-sm overflow-hidden">
      <div
        className="flex-shrink-0 cursor-pointer"
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
      >
        <Sidebar expanded={sidebarExpanded} />
      </div>

      <div className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="flex items-start justify-between mb-1">
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-1">
              LEARNING WORKSPACE
            </p>
            <span className="text-xs px-3 py-1 rounded-full border border-orange-300 bg-orange-50 text-orange-600 font-medium">
              Fallback data
            </span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Learning Modules</h1>
          <p className="text-gray-500 text-sm mb-6">
            Browse foundational transformer modules, preview guided lesson cards, connect yourself, and launch each module directly in the center panel.
          </p>

          <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 mb-6">
            <p className="font-semibold text-gray-800 text-sm mb-1">
              Starter modules are shown from built-in fallback data while Supabase sync is unavailable.
            </p>
            <p className="text-gray-600 text-xs leading-relaxed">
              Supabase is temporarily unavailable, so starter modules are being shown from built-in local data.
              You can still browse all starter modules now, and Connect Me will queue local saves until Supabase is reachable again.
            </p>
          </div>

          <div className="border border-gray-200 rounded-xl p-6 mb-8">
            <h2 className="font-bold text-gray-800 text-base mb-5">
              Learning Modules backend diagnostics
            </h2>
            <div className="grid grid-cols-5 gap-3 mb-4">
              {diagnostics.map((d, i) => (
                <div key={i} className="border border-gray-200 rounded-xl p-3 bg-white">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2 leading-tight whitespace-pre-line">
                    {d.label}
                  </p>
                  {d.badge && (
                    <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 mb-1">
                      {d.badge}
                    </span>
                  )}
                  {d.value && (
                    <p className="text-sm font-bold text-gray-900 mb-1">{d.value}</p>
                  )}
                  {d.pass !== null && (
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-100 mb-1">
                      <CheckCircle2 size={12} className="text-emerald-600" />
                      <span className="text-xs font-semibold text-emerald-700">Pass</span>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-500 leading-tight">{d.sub}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {diagnostics2.map((d, i) => (
                <div key={i} className="border border-gray-200 rounded-xl p-3 bg-white">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2 leading-tight whitespace-pre-line">
                    {d.label}
                  </p>
                  <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-100 mb-1">
                    <CheckCircle2 size={12} className="text-emerald-600" />
                    <span className="text-xs font-semibold text-emerald-700">Pass</span>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-tight">{d.sub}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {modules.map((mod) => (
              <div
                key={mod.id}
                className="border border-gray-200 rounded-xl p-4 bg-white hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                    {mod.topics} topics
                  </span>
                  {mod.queuedSync && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-600 font-medium">
                      Queued sync
                    </span>
                  )}
                  {mod.fallback && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-orange-200 bg-orange-50 text-orange-500 font-medium">
                      Fallback
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-gray-900 text-[15px] mb-2 leading-snug">
                  {mod.title}
                </h3>
                <p className="text-gray-500 text-xs leading-relaxed mb-4">
                  {mod.description}
                </p>
                <div className="flex items-center gap-2">
                  {mod.connected ? (
                    <>
                      <button className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 px-3 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                        <Link2 size={13} />
                        <span>Connect Me</span>
                      </button>
                      <button className="flex-1 text-xs py-2 px-3 rounded-lg bg-gray-900 text-white font-semibold hover:bg-gray-800 transition-colors">
                        Start Module
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <Link2 size={13} />
                        <span>Queued locally</span>
                      </div>
                      <button className="ml-auto text-xs py-2 px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors">
                        Start Module
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
