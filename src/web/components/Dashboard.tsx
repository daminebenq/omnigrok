import { useState } from "react";
import { ChatArea } from "./ChatArea";
import { EnhancedModelCatalog } from "./EnhancedModelCatalog";
import type { ModelInfo } from "../lib/api";

interface DashboardProps {
  models: ModelInfo[];
  currentModel: string;
  onModelChange: (model: string) => void;
  messages: any[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

// Tab definitions
const tabs = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'agents', label: 'Agents', icon: '🤖' },
  { id: 'files', label: 'Files', icon: '📁' },
  { id: 'projects', label: 'Projects', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'mcps', label: 'MCPs', icon: '🔌' },
  { id: 'browser', label: 'Browser', icon: '🌐' }
];

// Placeholder components for each panel
const AgentsPanel = () => (
  <div className="p-6">
    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Agents Management</h2>
    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
      <p className="text-gray-600 dark:text-gray-300">Create, configure, and manage your AI agents.</p>
      <button className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        + Create New Agent
      </button>
    </div>
  </div>
);

const FilesPanel = () => (
  <div className="p-6">
    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Files Management</h2>
    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
      <p className="text-gray-600 dark:text-gray-300">Upload, organize, and manage your files.</p>
      <button className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
        📤 Upload Files
      </button>
    </div>
  </div>
);

const ProjectsPanel = () => (
  <div className="p-6">
    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Projects Management</h2>
    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
      <p className="text-gray-600 dark:text-gray-300">Create and manage your projects.</p>
      <button className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
        + New Project
      </button>
    </div>
  </div>
);

const SettingsPanel = ({ models, currentModel, onModelChange }: { models: ModelInfo[]; currentModel: string; onModelChange: (model: string) => void }) => {
  const [showModelCatalog, setShowModelCatalog] = useState(false);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Settings</h2>
      <div className="space-y-6">
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Model Settings</h3>
          <p className="text-gray-600 dark:text-gray-300 mb-4">Current model: {currentModel}</p>
          <button
            onClick={() => setShowModelCatalog(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            🧠 Browse Model Catalog
          </button>
        </div>
        
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">API Keys</h3>
          <p className="text-gray-600 dark:text-gray-300">Manage your API keys for different providers.</p>
        </div>
        
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Preferences</h3>
          <p className="text-gray-600 dark:text-gray-300">Customize your OmniGrok experience.</p>
        </div>
      </div>
      
      {showModelCatalog && (
        <EnhancedModelCatalog
          models={models}
          current={currentModel}
          onChange={onModelChange}
          onClose={() => setShowModelCatalog(false)}
        />
      )}
    </div>
  );
};

const MCPsPanel = () => (
  <div className="p-6">
    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">MCP Connections</h2>
    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
      <p className="text-gray-600 dark:text-gray-300">Manage your Model Context Protocol connections.</p>
      <button className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
        + Connect MCP Server
      </button>
    </div>
  </div>
);

const BrowserPanel = () => (
  <div className="p-6">
    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Built-in Browser</h2>
    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 h-96">
      <input
        type="url"
        placeholder="Enter URL to browse..."
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white mb-4"
      />
      <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg h-full p-4">
        <p className="text-gray-600 dark:text-gray-300">Browser content will appear here.</p>
      </div>
    </div>
  </div>
);

export function Dashboard({ models, currentModel, onModelChange, messages, onSendMessage, isLoading }: DashboardProps) {
  const [activeTab, setActiveTab] = useState('chat');

  const renderPanel = () => {
    switch (activeTab) {
      case 'chat':
        return (
          <ChatArea
            messages={messages}
            onSendMessage={onSendMessage}
            isLoading={isLoading}
          />
        );
      case 'agents':
        return <AgentsPanel />;
      case 'files':
        return <FilesPanel />;
      case 'projects':
        return <ProjectsPanel />;
      case 'settings':
        return (
          <SettingsPanel
            models={models}
            currentModel={currentModel}
            onModelChange={onModelChange}
          />
        );
      case 'mcps':
        return <MCPsPanel />;
      case 'browser':
        return <BrowserPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* Top Navigation Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        {renderPanel()}
      </div>
    </div>
  );
}
