import { useState, useMemo } from "react";
import type { ModelInfo } from "../lib/api";

interface EnhancedModelCatalogProps {
  models: ModelInfo[];
  current: string;
  onChange: (model: string) => void;
  onClose: () => void;
}

// Model capability detection
const getCapabilities = (model: ModelInfo) => {
  const capabilities: string[] = [];
  const id = model.id.toLowerCase();
  const provider = model.provider.toLowerCase();
  
  // Vision models
  if (id.includes('vision') || id.includes('4o') || id.includes('claude-3') || 
      id.includes('gemini') && id.includes('pro')) {
    capabilities.push('vision');
  }
  
  // Reasoning models
  if (id.includes('reasoning') || id.includes('o1') || id.includes('thinking') || 
      id.includes('claude-3-5-sonnet') || id.includes('gpt-4')) {
    capabilities.push('reasoning');
  }
  
  // Coding models
  if (id.includes('code') || id.includes('coding') || provider === 'auto' && id.includes('best-coding')) {
    capabilities.push('coding');
  }
  
  // Audio models
  if (id.includes('audio') || id.includes('whisper') || id.includes('speech')) {
    capabilities.push('audio');
  }
  
  // Image generation
  if (id.includes('dall') || id.includes('image') || id.includes('midjourney')) {
    capabilities.push('image');
  }
  
  return capabilities;
};

// Model reputation scoring
const getReputationScore = (model: ModelInfo) => {
  const id = model.id.toLowerCase();
  const provider = model.provider.toLowerCase();
  
  // Tier 1: Best models (90-100)
  if (id.includes('gpt-4o') || id.includes('claude-3-5-sonnet') || 
      id.includes('o1-preview') || provider === 'auto' && id.includes('best')) {
    return 95;
  }
  
  // Tier 2: Premium models (80-89)
  if (id.includes('gpt-4') || id.includes('claude-3') || 
      id.includes('gemini-1.5-pro')) {
    return 85;
  }
  
  // Tier 3: Good models (70-79)
  if (id.includes('gpt-3.5') || id.includes('claude-2') || 
      id.includes('gemini-pro')) {
    return 75;
  }
  
  // Default score
  return 65;
};

// Capability icons
const CapabilityIcon = ({ capability }: { capability: string }) => {
  const icons = {
    reasoning: '🧠',
    vision: '👁️',
    coding: '💻',
    audio: '🎵',
    image: '🖼️'
  };
  
  return (
    <span 
      className="inline-block text-xs mr-1" 
      title={capability}
    >
      {icons[capability as keyof typeof icons]}
    </span>
  );
};

export function EnhancedModelCatalog({ models, current, onChange, onClose }: EnhancedModelCatalogProps) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Process models with capabilities and reputation
  const processedModels = useMemo(() => {
    return models.map(model => ({
      ...model,
      capabilities: getCapabilities(model),
      reputation: getReputationScore(model)
    }));
  }, [models]);

  // Group by provider and sort by reputation
  const groupedModels = useMemo(() => {
    const filtered = processedModels.filter(model => {
      const matchesSearch = model.id.toLowerCase().includes(search.toLowerCase()) ||
                           model.provider.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || 
                             model.capabilities.includes(selectedCategory);
      return matchesSearch && matchesCategory;
    });

    const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, model) => {
      if (!acc[model.provider]) acc[model.provider] = [];
      acc[model.provider].push(model);
      return acc;
    }, {});

    // Sort each group by reputation (descending)
    Object.keys(grouped).forEach(provider => {
      grouped[provider].sort((a, b) => b.reputation - a.reputation);
    });

    return grouped;
  }, [processedModels, search, selectedCategory]);

  const categories = ['all', 'reasoning', 'vision', 'coding', 'audio', 'image'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Model Catalog ({processedModels.length} models)
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ✕
            </button>
          </div>
          
          <div className="flex gap-4 mb-4">
            <input
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : `${cat.charAt(0).toUpperCase()}${cat.slice(1)}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-y-auto max-h-[60vh] p-4">
          {Object.entries(groupedModels).map(([provider, models]) => (
            <div key={provider} className="mb-6">
              <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-3 capitalize">
                {provider} ({models.length})
              </h3>
              <div className="space-y-2">
                {models.map(model => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onChange(model.id);
                      onClose();
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      current === model.id
                        ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700'
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-gray-900 dark:text-white">
                            {model.id.split('/').pop()}
                          </span>
                          <div className="flex">
                            {model.capabilities.map(cap => (
                              <CapabilityIcon key={cap} capability={cap} />
                            ))}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {model.provider}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Score: {model.reputation}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
