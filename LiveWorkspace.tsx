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
  Copy,
  Menu,
  Link2,
} from "lucide-react";

const navItems = [
  { icon: LayoutDashboard, label: "Current Site", active: true },
  { icon: Eye, label: "Top Sites", active: false },
  { icon: FileText, label: "Learning Modules", active: false },
  { icon: Settings, label: "Settings", active: false },
  { icon: Shield, label: "Privacy Policy", active: false },
  { icon: Pencil, label: "Edit Profile", active: false },
  { icon: Cloud, label: "Supabase Configuration", active: false },
  { icon: Database, label: "Data Controls", active: false },
];

function ConnectMeLogo() {
  return (
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center border-b border-gray-100 last:border-0">
      <div className="w-40 py-3 pr-4">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
          {label}
        </span>
      </div>
      <div className="flex-1 py-3">
        <span className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-1.5 block">
          {value}
        </span>
      </div>
    </div>
  );
}

export function LiveWorkspace() {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [presenceOn, setPresenceOn] = useState(true);

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
        <div className="max-w-4xl mx-auto px-8 py-8">
          <div className="flex items-start justify-between mb-1">
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-1">
              LIVE WORKSPACE
            </p>
            <span className="text-xs px-3 py-1 rounded-full border border-gray-200 bg-gray-50 text-gray-600 font-medium">
              Background synced
            </span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Current Site</h1>
          <p className="text-gray-500 text-sm mb-8">
            Your background-owned active-site state, privacy-scoped URL detail, your profile summary, and live members on the same site.
          </p>

          <div className="border border-gray-200 rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-gray-900 text-base">Tracked site detail</h2>
              <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors font-medium">
                <Copy size={13} />
                Copy visible URL
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-5">Your privacy settings allow the full URL to be shown.</p>
            <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
              <InfoRow label="Tracking Scope" value="Full URL" />
              <InfoRow label="Domain" value="app.alignerr.com" />
              <InfoRow label="Domain + Path" value="app.alignerr.com/home" />
              <InfoRow label="Full URL" value="https://app.alignerr.com/home" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-bold text-gray-900 text-base">Profile summary</h2>
                <button className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors font-medium text-center leading-tight">
                  Edit<br />profile
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                The public-facing snapshot others can see according to your visibility controls.
              </p>

              <div className="border border-gray-100 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-gray-600 overflow-hidden flex-shrink-0">
                    <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
                      <rect width="40" height="40" fill="#4b5563" />
                      <circle cx="20" cy="15" r="7" fill="#d1d5db" />
                      <ellipse cx="20" cy="34" rx="14" ry="10" fill="#d1d5db" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 text-sm">Sophia Siliann</p>
                    <p className="text-xs text-gray-500">Researcher · Educator · Product Builder</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="text-[11px] px-2 py-0.5 border border-gray-200 rounded-full text-gray-600">
                    <span className="font-semibold">Work:</span> I-O-A-I
                  </span>
                  <span className="text-[11px] px-2 py-0.5 border border-gray-200 rounded-full text-gray-600">
                    <span className="font-semibold">Education:</span> M.S./M.A.T.
                  </span>
                  <span className="text-[11px] px-2 py-0.5 border border-gray-200 rounded-full text-gray-600">
                    <span className="font-semibold">Location:</span> NYC
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-3">No bio added yet.</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Public avatar: Share",
                    "Public first name: Share",
                    "Public last name: Share",
                    "Public work: Share",
                  ].map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-2 py-0.5 border border-gray-200 rounded-full text-gray-500 bg-gray-50"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-bold text-gray-900 text-base">Presence controls</h2>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 font-medium">ON/OFF</span>
                  <button
                    onClick={() => setPresenceOn(!presenceOn)}
                    className={`w-6 h-6 rounded flex items-center justify-center border-2 transition-colors ${
                      presenceOn
                        ? "bg-blue-600 border-blue-600"
                        : "bg-white border-gray-300"
                    }`}
                  >
                    {presenceOn && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-5">
                Available only when presence sharing is on and Invisible Mode is off.
              </p>

              <div className="space-y-3">
                <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-700">
                    Presence sharing is on. Only currently active users are shown.
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-400 italic">
                    {presenceOn
                      ? "No other active users are visible on this site right now."
                      : "Refreshing live members..."}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-700 mb-2">Live members on this site</p>
                  <div className="space-y-2">
                    {[
                      { name: "Alex M.", role: "Researcher", active: true },
                      { name: "Jordan K.", role: "Developer", active: true },
                    ].map((member) => (
                      <div key={member.name} className="flex items-center gap-2 py-1.5">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-[11px] font-bold text-blue-700 flex-shrink-0">
                          {member.name[0]}
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-medium text-gray-800">{member.name}</p>
                          <p className="text-[10px] text-gray-400">{member.role}</p>
                        </div>
                        <span className="w-2 h-2 rounded-full bg-green-400" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
