import { useState } from "react";

interface WorkingIndicatorProps {
  isWorking: boolean;
  logs?: {
    reasoning?: string[];
    tokens?: { input: number; output: number; total: number };
    thinking?: string;
    sources?: string[];
  };
}

export function WorkingIndicator({ isWorking, logs }: WorkingIndicatorProps) {
  const [showLogs, setShowLogs] = useState(false);

  if (!isWorking) return null;

  return (
    <div className="relative inline-block">
      {/* Working animation */}
      <div 
        className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg cursor-pointer"
        onMouseEnter={() => setShowLogs(true)}
        onMouseLeave={() => setShowLogs(false)}
      >
        <div className="flex gap-1">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
        </div>
        <span className="text-sm font-medium">Thinking...</span>
      </div>

      {/* Hover logs popup */}
      {showLogs && logs && (
        <div className="absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-4 z-50">
          <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Processing Details</h4>
          
          {logs.reasoning && logs.reasoning.length > 0 && (
            <div className="mb-3">
              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">🧠 Reasoning:</h5>
              <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                {logs.reasoning.map((step, i) => (
                  <div key={i} className="pl-2 border-l-2 border-blue-200 dark:border-blue-700">
                    {step}
                  </div>
                ))}
              </div>
            </div>
          )}

          {logs.tokens && (
            <div className="mb-3">
              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">📊 Token Usage:</h5>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                <div>Input: {logs.tokens.input.toLocaleString()}</div>
                <div>Output: {logs.tokens.output.toLocaleString()}</div>
                <div>Total: {logs.tokens.total.toLocaleString()}</div>
              </div>
            </div>
          )}

          {logs.thinking && (
            <div className="mb-3">
              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">💭 Thinking:</h5>
              <div className="text-xs text-gray-600 dark:text-gray-400 max-h-20 overflow-y-auto">
                {logs.thinking}
              </div>
            </div>
          )}

          {logs.sources && logs.sources.length > 0 && (
            <div>
              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">📚 Sources:</h5>
              <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                {logs.sources.map((source, i) => (
                  <div key={i} className="truncate">{source}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
