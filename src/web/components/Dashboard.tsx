import { useState } from "react";
import { ChatArea } from "./ChatArea";
import { Sidebar } from "./Sidebar";
import { EnhancedModelCatalog } from "./EnhancedModelCatalog";
import { Icon, type IconName } from "./Icon";
import { AgentsPanel } from "./panels/AgentsPanel";
import { FilesPanel } from "./panels/FilesPanel";
import { ProjectsPanel } from "./panels/ProjectsPanel";
import { McpPanel } from "./panels/McpPanel";
import { BrowserPanel } from "./panels/BrowserPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import type { Conversation, ModelInfo } from "../lib/api";
import type { LiveLogs } from "../App";

type TabId = "chat" | "agents" | "files" | "projects" | "mcps" | "browser" | "settings";

const TABS: Array<{ id: TabId; label: string; icon: IconName }> = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "agents", label: "Agents", icon: "agents" },
  { id: "files", label: "Files", icon: "files" },
  { id: "projects", label: "Projects", icon: "projects" },
  { id: "mcps", label: "MCPs", icon: "mcp" },
  { id: "browser", label: "Browser", icon: "browser" },
  { id: "settings", label: "Settings", icon: "settings" },
];

interface DashboardProps {
  models: ModelInfo[];
  conversations: Conversation[];
  activeConv: Conversation | null;
  activeConvId: string;
  streaming: boolean;
  logs: LiveLogs | null;
  error: string | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSelectConv: (id: string) => void;
  onNewChat: () => void;
  onDeleteConv: (id: string) => void;
  onModelChange: (model: string) => void;
  onSend: (content: string) => void;
  onStop: () => void;
  onDismissError: () => void;
}

export function Dashboard({
  models,
  conversations,
  activeConv,
  activeConvId,
  streaming,
  logs,
  error,
  sidebarOpen,
  onToggleSidebar,
  onSelectConv,
  onNewChat,
  onDeleteConv,
  onModelChange,
  onSend,
  onStop,
  onDismissError,
}: DashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [catalogOpen, setCatalogOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
      {/* Tab rail */}
      <nav
        className="flex items-center gap-1 px-2 border-b border-border-subtle bg-bg-secondary/60 backdrop-blur-sm overflow-x-auto"
        aria-label="Workspace sections"
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap
                transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60 rounded-t
                ${
                  active
                    ? "border-accent-purple text-text-primary"
                    : "border-transparent text-text-tertiary hover:text-text-secondary"
                }`}
            >
              <Icon name={tab.icon} size={15} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 px-4 py-2.5 bg-accent-red/10 border-b border-accent-red/30 text-sm text-text-primary"
        >
          <Icon name="warning" size={15} className="text-accent-red mt-0.5 shrink-0" />
          <span className="flex-1 min-w-0 break-words">{error}</span>
          <button
            onClick={onDismissError}
            aria-label="Dismiss error"
            className="shrink-0 p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {activeTab === "chat" ? (
          <div className="flex h-full min-h-0 relative">
            {sidebarOpen && (
              <button
                aria-label="Close conversations"
                onClick={onToggleSidebar}
                className="lg:hidden fixed inset-0 z-20 bg-black/50 cursor-default"
              />
            )}
            <Sidebar
              open={sidebarOpen}
              conversations={conversations}
              activeId={activeConvId}
              onSelect={onSelectConv}
              onDelete={onDeleteConv}
              onNewChat={onNewChat}
              models={models}
              currentModel={activeConv?.model ?? ""}
              onModelChange={onModelChange}
              onClose={onToggleSidebar}
              onBrowseCatalog={() => setCatalogOpen(true)}
            />
            <ChatArea
              conversation={activeConv}
              streaming={streaming}
              logs={logs}
              onSend={onSend}
              onStop={onStop}
              onToggleSidebar={onToggleSidebar}
              sidebarOpen={sidebarOpen}
            />
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            {activeTab === "agents" && <AgentsPanel models={models} />}
            {activeTab === "files" && <FilesPanel />}
            {activeTab === "projects" && <ProjectsPanel />}
            {activeTab === "mcps" && <McpPanel />}
            {activeTab === "browser" && <BrowserPanel />}
            {activeTab === "settings" && (
              <SettingsPanel
                models={models}
                currentModel={activeConv?.model ?? ""}
                onBrowseCatalog={() => setCatalogOpen(true)}
              />
            )}
          </div>
        )}
      </div>

      {catalogOpen && (
        <EnhancedModelCatalog
          models={models}
          current={activeConv?.model ?? ""}
          onChange={onModelChange}
          onClose={() => setCatalogOpen(false)}
        />
      )}
    </div>
  );
}
