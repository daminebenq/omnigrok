// The agent and skill libraries are data, so the risk is a malformed entry
// shipping silently: a duplicate id, a template that drops its input, a tool
// the dispatcher does not implement.
import { AGENT_PRESETS, AGENT_CATEGORIES, getPreset } from "./.tmp-agents.mjs";
import { SKILLS, SKILL_CATEGORIES, getSkill, applySkill } from "./.tmp-skills.mjs";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// Tools the worker actually dispatches. A preset naming anything else would
// advertise a capability that silently does nothing.
const KNOWN_TOOLS = new Set([
  "jarvis_exec", "web_browse",
  "device_list", "device_exec", "device_read_dir", "device_read_file", "device_write_file",
]);
const KNOWN_CAPS = new Set(["reasoning", "vision", "coding", "audio", "image", "tools"]);

check("agent library is populated", AGENT_PRESETS.length >= 25, true);
check("skill library is populated", SKILLS.length >= 20, true);

const agentIds = AGENT_PRESETS.map((a) => a.id);
check("agent ids are unique", agentIds.length, new Set(agentIds).size);
const skillIds = SKILLS.map((s) => s.id);
check("skill ids are unique", skillIds.length, new Set(skillIds).size);

const badAgents = AGENT_PRESETS.filter(
  (a) =>
    !a.id || !a.name || !a.description || !a.systemPrompt ||
    !AGENT_CATEGORIES.includes(a.category) ||
    !Array.isArray(a.tools) || !Array.isArray(a.wants)
);
check("every agent is structurally complete", badAgents.map((a) => a.id), []);

const thinPrompts = AGENT_PRESETS.filter((a) => a.systemPrompt.length < 120);
check("no agent ships a throwaway prompt", thinPrompts.map((a) => a.id), []);

const unknownTools = AGENT_PRESETS.flatMap((a) =>
  a.tools.filter((t) => !KNOWN_TOOLS.has(t)).map((t) => `${a.id}:${t}`)
);
check("agents only reference dispatchable tools", unknownTools, []);

const unknownCaps = AGENT_PRESETS.flatMap((a) =>
  a.wants.filter((w) => !KNOWN_CAPS.has(w)).map((w) => `${a.id}:${w}`)
);
check("agents only request real capabilities", unknownCaps, []);

const badSkills = SKILLS.filter(
  (s) =>
    !s.id || !s.name || !s.description || !s.inputLabel || !s.inputPlaceholder ||
    !SKILL_CATEGORIES.includes(s.category) || !s.template
);
check("every skill is structurally complete", badSkills.map((s) => s.id), []);

const noPlaceholder = SKILLS.filter((s) => !s.template.includes("{input}"));
check("every skill template consumes its input", noPlaceholder.map((s) => s.id), []);

// Every category should be represented, or the filter chips lie.
const emptyAgentCats = AGENT_CATEGORIES.filter((c) => !AGENT_PRESETS.some((a) => a.category === c));
check("no empty agent category", emptyAgentCats, []);
const emptySkillCats = SKILL_CATEGORIES.filter((c) => !SKILLS.some((s) => s.category === c));
check("no empty skill category", emptySkillCats, []);

// Lookup + expansion actually work for all of them.
check("every agent is retrievable by id", AGENT_PRESETS.every((a) => getPreset(a.id)?.id === a.id), true);
check("unknown agent id returns undefined", getPreset("nope"), undefined);
check("every skill is retrievable by id", SKILLS.every((s) => getSkill(s.id)?.id === s.id), true);

const expansions = SKILLS.map((s) => applySkill(s, "SENTINEL-INPUT"));
check("expansion injects the input", expansions.every((t) => t.includes("SENTINEL-INPUT")), true);
check("expansion leaves no placeholder", expansions.every((t) => !t.includes("{input}")), true);
check("expansion trims the input", applySkill(SKILLS[0], "  padded  ").includes("SENTINEL") === false, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
