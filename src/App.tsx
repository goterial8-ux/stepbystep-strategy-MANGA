import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_STATE, ProjectState, StageId, StageStatus, SupervisorReport, CleanExportSettings, ScriptPart, STAGES } from './types';
import { TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { SupervisorPanel } from './components/SupervisorPanel';
import { Bug, X } from 'lucide-react';

export default function App() {
  const [state, setState] = useState<ProjectState>(() => {
    const saved = localStorage.getItem('studio_writer_project');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Ensure registry is always present from template even if old state didn't have it
        if (!parsed.promptRegistry) {
          parsed.promptRegistry = INITIAL_STATE.promptRegistry;
        } else {
          // Force upgrade core rules if missing new genre anchors
          if (!parsed.promptRegistry.globalRulesPrompt.includes('ЗАПРЕТ НА СКУКУ')) {
            parsed.promptRegistry.globalRulesPrompt = INITIAL_STATE.promptRegistry.globalRulesPrompt;
          }
          if (!parsed.promptRegistry.aiSupervisorPrompt.includes('GENRE DRIFT FIX FORMAT') || !parsed.promptRegistry.aiSupervisorPrompt.includes('всесильный') || !parsed.promptRegistry.aiSupervisorPrompt.includes('Скучно/уныло?') || !parsed.promptRegistry.aiSupervisorPrompt.includes('adjective soup') || !parsed.promptRegistry.aiSupervisorPrompt.includes('detached robot') || !parsed.promptRegistry.aiSupervisorPrompt.includes('lazy')) {
            parsed.promptRegistry.aiSupervisorPrompt = INITIAL_STATE.promptRegistry.aiSupervisorPrompt;
          }
          if (!parsed.promptRegistry.stageFiveScriptWriterPrompt || !parsed.promptRegistry.stageFiveScriptWriterPrompt.includes('ADJECTIVE DISCIPLINE') || !parsed.promptRegistry.stageFiveScriptWriterPrompt.includes('АНТИ-ИМБА') || !parsed.promptRegistry.stageFiveScriptWriterPrompt.includes('ЗАПРЕТ НА СКУКУ И УНЫЛОСТЬ') || !parsed.promptRegistry.stageFiveScriptWriterPrompt.includes('ZERO TOLERANCE FOR FLUFF') || !parsed.promptRegistry.stageFiveScriptWriterPrompt.includes('HOW TO REACH 10,000+ CHARACTERS WITHOUT FLUFF') || !parsed.promptRegistry.stageFiveScriptWriterPrompt.includes('ЖИВОЙ РАССКАЗЧИК') || !parsed.promptRegistry.stageFiveScriptWriterPrompt.includes('SENTENCE RULES — NON-NEGOTIABLE') || !parsed.promptRegistry.stageFiveScriptWriterPrompt.includes('FACE SLAP / PAYOFF CHECKLIST (ADAPT TO SCENE)')) {
            parsed.promptRegistry.stageFiveScriptWriterPrompt = INITIAL_STATE.promptRegistry.stageFiveScriptWriterPrompt;
          }
        }
        return parsed;
      } catch (e) {
        console.error("Failed to parse saved state", e);
        return INITIAL_STATE;
      }
    }
    return INITIAL_STATE;
  });
  const stateRef = useRef<ProjectState>(state);

  const [currentStageId, setCurrentStageId] = useState<StageId>(() => {
    return (localStorage.getItem('studio_writer_stage') as StageId) || 'raw_idea';
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    stopRequestedRef.current = stopRequested;
  }, [stopRequested]);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [generationAttempt, setGenerationAttempt] = useState<number>(0);
  const [generationMaxAttempts] = useState<number>(10);

  const fetchWithRetry = async (
    url: string,
    options: RequestInit,
    maxAttempts = 10,
    timeoutMs = 300000
  ): Promise<any> => {
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt++;
      setGenerationAttempt(attempt);
      console.log(`Fetch attempt ${attempt} of ${maxAttempts} for ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const raw = await response.text();
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          console.error("Backend non-JSON response on attempt", attempt, raw);
          throw new Error("Backend returned non-JSON response. Intermediary service timeout. Retrying...");
        }

        if (!response.ok) {
          throw new Error(parsed.error || `HTTP ${response.status} Error`);
        }

        if (parsed.success === false) {
          throw new Error(parsed.error || 'Generation failed');
        }

        // Success!
        setGenerationAttempt(0);
        return parsed;

      } catch (err: any) {
        clearTimeout(timeoutId);
        console.warn(`Attempt ${attempt} failed:`, err);

        // If batch or user stopped, abort
        if (stopRequestedRef.current) {
          setGenerationAttempt(0);
          throw new Error("Generation stopped by user.");
        }

        if (attempt >= maxAttempts) {
          setGenerationAttempt(0);
          throw err;
        }

        // Show a temporary visual message of retrying
        setWarningMessage(`Attempt ${attempt} of ${maxAttempts} timed out or failed. Retrying...`);
        setTimeout(() => setWarningMessage(null), 3500);

        // Wait with a small dynamic backoff before retrying
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    setGenerationAttempt(0);
    throw new Error("Maximum generation attempts reached.");
  };

  useEffect(() => {
    setSaveStatus('saving');
    localStorage.setItem('studio_writer_project', JSON.stringify(state));
    localStorage.setItem('studio_writer_stage', currentStageId);
    const timer = setTimeout(() => setSaveStatus('saved'), 500);
    return () => clearTimeout(timer);
  }, [state, currentStageId]);

  const handleResetProject = () => {
    if (window.confirm("Are you sure you want to start a new project? This will clear all current work.")) {
      localStorage.removeItem('studio_writer_project');
      localStorage.removeItem('studio_writer_stage');
      setState(INITIAL_STATE);
      stateRef.current = INITIAL_STATE;
      setCurrentStageId('raw_idea');
    }
  };

  const handleUnlockStage = (stageId: StageId) => {
    updateStageStatus(stageId, 'generated');
    updateState({
      lockedData: { ...stateRef.current.lockedData, [stageId]: false }
    });
  };

  const updateState = (partial: Partial<ProjectState>) => {
    setState(prev => {
      const next = { ...prev, ...partial };
      stateRef.current = next;
      return next;
    });
  };

  const updateStageStatus = (stageId: StageId, status: StageStatus) => {
    setState(prev => {
      const next = {
        ...prev,
        stageStatuses: { ...prev.stageStatuses, [stageId]: status }
      };
      stateRef.current = next;
      return next;
    });
  };

  const updateExportSettings = (partial: Partial<CleanExportSettings>) => {
    setState(prev => {
      const next = {
        ...prev,
        cleanExportSettings: { ...prev.cleanExportSettings, ...partial }
      };
      stateRef.current = next;
      return next;
    });
  }

  const getStageContent = (stageId: StageId): string => {
    switch(stageId) {
      case 'raw_idea': return state.developedIdea;
      case 'story_dna': return state.storyContract;
      case 'story_plan': return state.storyPlan;
      case 'scene_cards': return state.sceneCards;
      case 'script_writer': return state.fullScript;
      case 'clean_export': return state.finalCleanScript;
      default: return '';
    }
  };

  const setStageContent = (stageId: StageId, content: string) => {
    switch(stageId) {
      case 'raw_idea': updateState({ developedIdea: content }); break;
      case 'story_dna': updateState({ storyContract: content }); break;
      case 'story_plan': updateState({ storyPlan: content }); break;
      case 'scene_cards': updateState({ sceneCards: content }); break;
      case 'script_writer': updateState({ fullScript: content }); break;
      case 'clean_export': updateState({ finalCleanScript: content }); break;
    }
  };

  const canProceedToStage = (stageId: StageId): { allowed: boolean; warning?: string } => {
    if (stageId === 'story_dna' && state.stageStatuses['raw_idea'] !== 'locked') return { allowed: false, warning: 'Stage One (Raw Idea) must be locked before starting Story DNA.' };
    if (stageId === 'story_plan' && state.stageStatuses['story_dna'] !== 'locked') return { allowed: false, warning: 'Story Contract must be locked before starting Story Plan.' };
    if (stageId === 'scene_cards' && state.stageStatuses['story_plan'] !== 'locked') return { allowed: false, warning: 'Story Plan must be locked before generating Scene Cards.' };
    if (stageId === 'script_writer' && state.stageStatuses['scene_cards'] !== 'locked') return { allowed: false, warning: 'Scene Cards must be locked before writing Script.' };
    return { allowed: true };
  };

  const handleGenerate = () => {
    const check = canProceedToStage(currentStageId);
    if (!check.allowed) {
      setWarningMessage(check.warning || 'Check previous stages.');
      setTimeout(() => setWarningMessage(null), 4000);
      return;
    }

    import('./lib/PromptBuilder').then(({ buildPrompt }) => {
      const promptUsed = buildPrompt(currentStageId, state);
      
      setIsGenerating(true);
      fetchWithRetry('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptUsed, type: 'text', stageId: currentStageId })
      })
      .then(data => {
        const textOutput = data.text;
        setStageContent(currentStageId, textOutput);
        updateStageStatus(currentStageId, 'generated');
        
        const newHistoryEntry = {
          id: Date.now().toString(),
          stageId: currentStageId,
          promptUsed,
          inputDataSummary: `Generated for ${currentStageId}`,
          outputPreview: textOutput.substring(0, 300) + (textOutput.length > 300 ? '...' : ''),
          createdAt: Date.now(),
          supervisorStatus: null,
          repairApplied: false,
          lockedStatus: false
        };

        updateState({
          supervisorReports: {
            ...state.supervisorReports,
            [currentStageId]: null
          },
          promptHistory: [newHistoryEntry, ...state.promptHistory]
        });
      })
      .catch(err => {
        console.error("Generation failed:", err);
        setWarningMessage(err.message || 'Error occurred during generation.');
        setTimeout(() => setWarningMessage(null), 5000);
      })
      .finally(() => {
        setIsGenerating(false);
      });
    });
  };

  const handleApproveAndLock = () => {
    if (currentStageId === 'script_writer') {
      const assembledContent = state.scriptParts.map(p => `## Part ${p.partNumber}: ${p.partTitle}\n\n${p.draftText}`).join('\n\n');
      updateState({ 
        fullScript: assembledContent,
        stageStatuses: { ...state.stageStatuses, script_writer: 'locked' as const },
        lockedData: { ...state.lockedData, script_writer: true }
      });
    } else {
      updateStageStatus(currentStageId, 'locked');
      updateState({
        lockedData: { ...state.lockedData, [currentStageId]: true }
      });
    }
  };

  const handleSendToNext = () => {
    const currentState = stateRef.current;
    if (currentState.stageStatuses[currentStageId] !== 'locked') {
      updateStageStatus(currentStageId, 'locked');
    }
    const currentIndex = STAGES.findIndex(s => s.id === currentStageId);
    if (currentIndex >= 0 && currentIndex < STAGES.length - 1) {
      const nextStage = STAGES[currentIndex + 1].id;
      setCurrentStageId(nextStage);
    }
  };

  // --- Supervisor --
  const handleAnalyze = () => {
    import('./lib/PromptBuilder').then(({ buildSupervisorPrompt }) => {
      const promptUsed = buildSupervisorPrompt(currentStageId, getStageContent(currentStageId), state);
      
      setIsGenerating(true);
      fetchWithRetry('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptUsed, type: 'supervisor', stageId: currentStageId })
      })
      .then(data => {
        const report: SupervisorReport = data.parsed;
        
        const newHistoryEntry = {
            id: Date.now().toString(),
            stageId: currentStageId,
            promptUsed,
            inputDataSummary: `Analyze output for ${currentStageId}`,
            outputPreview: JSON.stringify(report, null, 2),
            createdAt: Date.now(),
            supervisorStatus: report.status,
            repairApplied: false,
            lockedStatus: false
        };

        updateState({
          supervisorReports: { ...state.supervisorReports, [currentStageId]: report },
          promptHistory: [newHistoryEntry, ...state.promptHistory]
        });
        
        if (report.canContinue) {
          updateStageStatus(currentStageId, 'generated');
        } else {
          updateStageStatus(currentStageId, 'needs_repair');
        }
      })
      .catch(err => {
        console.error("Analysis failed:", err);
        setWarningMessage(err.message || 'Error occurred during supervisor analysis.');
        setTimeout(() => setWarningMessage(null), 5000);
      })
      .finally(() => {
        setIsGenerating(false);
      });
    });
  };

  const handleApplyRepair = () => {
    import('./lib/PromptBuilder').then(({ buildRepairPrompt }) => {
      const mockReport = state.supervisorReports[currentStageId];
      const promptUsed = buildRepairPrompt(currentStageId, getStageContent(currentStageId), mockReport, state);
      
      setIsGenerating(true);
      fetchWithRetry('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptUsed, type: 'text', stageId: currentStageId })
      })
      .then(data => {
        const textOutput = data.text;
        setStageContent(currentStageId, textOutput);
        
        const okReport: SupervisorReport = {
          status: 'ok',
          whatIsGood: 'Content aligns well with requirements.',
          problems: [],
          requiredFixes: [],
          recommendation: 'Safe to proceed.',
          canContinue: true
        };

        const newHistoryEntry = {
            id: Date.now().toString(),
            stageId: currentStageId,
            promptUsed,
            inputDataSummary: `Repair output for ${currentStageId}`,
            outputPreview: textOutput.substring(0, 300) + (textOutput.length > 300 ? '...' : ''),
            createdAt: Date.now(),
            supervisorStatus: 'ok',
            repairApplied: true,
            lockedStatus: false
        };

        updateState({
          supervisorReports: { ...state.supervisorReports, [currentStageId]: okReport },
          promptHistory: [newHistoryEntry, ...state.promptHistory]
        });
        updateStageStatus(currentStageId, 'generated'); // Back to generated (repaired)
      })
      .catch(err => {
        console.error("Repair failed:", err);
        setWarningMessage(err.message || 'Error occurred during repair.');
        setTimeout(() => setWarningMessage(null), 5000);
      })
      .finally(() => {
        setIsGenerating(false);
      });
    });
  };

  const handleApproveAnyway = () => {
    updateStageStatus(currentStageId, 'approved');
  };

  // --- Script Part Actions ---
  const updateScriptPart = (index: number, partial: Partial<ScriptPart>) => {
    setState(prev => {
      const updatedParts = [...prev.scriptParts];
      updatedParts[index] = { ...updatedParts[index], ...partial };
      const next = { ...prev, scriptParts: updatedParts };
      stateRef.current = next;
      return next;
    });
  };
  
  const handleInitScriptParts = () => {
    // Try to parse parts from storyPlan
    const parts: ScriptPart[] = [];
    const currentState = stateRef.current;
    
    // Crop story plan to exclude everything from Section 13 / HIDDEN CARD TIMING MAP onwards
    let planText = currentState.storyPlan || '';
    const cutOffRegex = /(?:\r?\n|^)\s*(?:Thirteen|13|Тринадцать|Тринадцатая)\s*[:.-—\s]\s*(?:HIDDEN\s+CARD|RESOURCE|ESCALATION|TIMING)/i;
    const cutOffMatch = planText.match(cutOffRegex);
    if (cutOffMatch && cutOffMatch.index !== undefined) {
      planText = planText.substring(0, cutOffMatch.index);
    }

    // Supporting spelled-out parts (e.g., "PART ONE", "ЧАСТЬ ОДИН", "Part 1")
    const wordToNum: Record<string, number> = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
      'один': 1, 'два': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10,
      'первая': 1, 'вторая': 2, 'третья': 3, 'четвертая': 4, 'пятая': 5, 'шестая': 6, 'седьмая': 7, 'восьмая': 8, 'девятая': 9, 'десятая': 10,
      'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7, 'viii': 8, 'ix': 9, 'x': 10
    };

    // Robust line matcher supporting optional list prefixes
    // Captures group 1 (part number/word) and group 2 (title)
    const partListRegex = /(?:^|\n)[^\n]*(?:Part|Часть)\s*(one|two|three|four|five|six|seven|eight|nine|ten|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять|первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая|i|ii|iii|iv|v|vi|vii|viii|ix|x|\d+)\s*[:.-—]\s*([^\n]+)/gi;
    let match;
    const matches: { number: number, title: string }[] = [];
    const seenNumbers = new Set<number>();
    
    while ((match = partListRegex.exec(planText)) !== null) {
      const pstr = match[1].toLowerCase();
      const num = wordToNum[pstr] || parseInt(pstr) || 0;
      if (num > 0) {
        if (!seenNumbers.has(num)) {
          seenNumbers.add(num);
          matches.push({ number: num, title: match[2].trim() });
        }
      }
    }
    
    // Sort matches by part number to ensure correct order
    matches.sort((a, b) => a.number - b.number);

    if (matches.length > 0) {
      matches.forEach((m) => {
        parts.push({
          partNumber: m.number,
          partTitle: m.title,
          sourceSceneCards: `Scenes for ${m.title}`,
          draftText: '',
          status: 'not_started',
          supervisorReport: null,
          isComplete: false,
          wordOrCharacterCount: 0,
          hasGenerationResidue: false,
          hasDuplicateBlocks: false,
          avatarCount: 0
        });
      });
    } else {
      // 2. Try to find explicit count: "Number of Parts: X" or "Количество частей: X"
      const countRegex = /(?:Number of Parts|Количество частей|Parts|Частей)\s*[:.-]?\s*(\d+|Девять|Восемь|Семь|Шесть|Пять|Четыре|Три|Два|Один)/i;
      const countMatch = currentState.storyPlan.match(countRegex);
      
      let numParts = 9; // default fallback if everything fails (canon is 9 parts)
      if (countMatch) {
         const val = countMatch[1].toLowerCase();
         const russianMap: Record<string, number> = {
           'один': 1, 'два': 2, 'три': 3, 'четыре': 4, 'пять': 5, 
           'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10
         };
         numParts = russianMap[val] || parseInt(val) || 9;
      }
      
      for (let i = 1; i <= numParts; i++) {
        parts.push({
          partNumber: i,
          partTitle: i === 1 ? 'Introduction & Hook' : `Part ${i}`,
          sourceSceneCards: `Scenes for Part ${i}`,
          draftText: '',
          status: 'not_started',
          supervisorReport: null,
          isComplete: false,
          wordOrCharacterCount: 0,
          hasGenerationResidue: false,
          hasDuplicateBlocks: false,
          avatarCount: 0
        });
      }
    }

    updateState({ scriptParts: parts });
    updateStageStatus('script_writer', 'generated');
  };

  const handleGeneratePart = async (index: number) => {
    try {
      const { buildPartPrompt } = await import('./lib/PromptBuilder');
      const currentState = stateRef.current;
      const partNum = currentState.scriptParts[index].partNumber;
      const promptUsed = buildPartPrompt(partNum, currentState);
      
      setIsGenerating(true);
      const data = await fetchWithRetry('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptUsed, type: 'text', stageId: 'script_writer' })
      });

      const textOutput = data.text;
      
      const newHistoryEntry = {
          id: Date.now().toString(),
          stageId: 'script_writer',
          promptUsed,
          inputDataSummary: `Generated for Script Part ${partNum}`,
          outputPreview: textOutput.substring(0, 300) + (textOutput.length > 300 ? '...' : ''),
          createdAt: Date.now(),
          supervisorStatus: null,
          repairApplied: false,
          lockedStatus: false
      };
      
      updateScriptPart(index, { status: 'generated', draftText: textOutput, wordOrCharacterCount: textOutput.length });
      updateState({
          promptHistory: [newHistoryEntry, ...stateRef.current.promptHistory]
      });
      return true;
    } catch (err: any) {
      console.error("Part generation failed:", err);
      setWarningMessage(err.message || 'Error occurred during part generation.');
      setTimeout(() => setWarningMessage(null), 5000);
      return false;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAllParts = async () => {
    setIsBatchGenerating(true);
    setStopRequested(false);
    stopRequestedRef.current = false;

    // We use a local index to avoid issues with stale state in the loop
    for (let i = 0; i < stateRef.current.scriptParts.length; i++) {
        if (stopRequestedRef.current) break;
        
        // Use stateRef.current to get the actual up-to-date parts on every loop iteration
        const currentParts = stateRef.current.scriptParts; 
        if (currentParts[i].draftText && currentParts[i].draftText.length > 0) {
            continue;
        }

        const success = await handleGeneratePart(i);
        if (!success || stopRequestedRef.current) break;
    }

    setIsBatchGenerating(false);
    setStopRequested(false);
    stopRequestedRef.current = false;
  };

  const handleStopBatchGeneration = () => {
    setStopRequested(true);
  };

  const handleClearAllParts = () => {
    const cleared = stateRef.current.scriptParts.map(p => ({ ...p, draftText: '', status: 'not_started' as const, wordOrCharacterCount: 0 }));
    updateState({ scriptParts: cleared, fullScript: '' });
  };

  const handleClearPart = (index: number) => {
    updateScriptPart(index, { draftText: '', status: 'not_started', wordOrCharacterCount: 0 });
  };
  
  const handleCheckPart = async (index: number) => {
    try {
      const { buildSupervisorPrompt, buildRepairPrompt } = await import('./lib/PromptBuilder');
      const currentState = stateRef.current;
      const part = currentState.scriptParts[index];
      const promptUsed = buildSupervisorPrompt('script_writer', part.draftText, currentState);
      
      setIsGenerating(true);
      
      // Step 1: Supervisor Analysis
      const analyzeData = await fetchWithRetry('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptUsed, type: 'json' })
      });
      const report = analyzeData.json as SupervisorReport;
      
      updateState({
        supervisorReports: {
          ...currentState.supervisorReports,
          script_writer: report
        }
      });
      
      const reportStr = JSON.stringify(report);
      const hasDrift = reportStr.includes('GENRE DRIFT DETECTED');
      
      if (!report.canContinue || hasDrift || report.status !== 'ok') {
        updateScriptPart(index, { status: 'needs_repair' });
        
        // Auto-repair immediately if drift is detected or it needs repair
        const repairPrompt = buildRepairPrompt('script_writer', part.draftText, report, currentState);
        const repairData = await fetchWithRetry('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: repairPrompt, type: 'text', stageId: 'script_writer' })
        });
        
        const newText = repairData.text;
        updateScriptPart(index, { 
          status: 'generated', 
          draftText: newText, 
          wordOrCharacterCount: newText.length,
          hasGenerationResidue: false
        });
        setWarningMessage('Part repaired automatically by Nova.');
        setTimeout(() => setWarningMessage(null), 4000);
      } else {
        updateScriptPart(index, { status: 'approved', hasGenerationResidue: false });
      }
      
    } catch (err: any) {
      console.error("Check/Repair Part failed:", err);
      setWarningMessage(err.message || 'Error occurred during part check.');
      setTimeout(() => setWarningMessage(null), 4000);
    } finally {
      setIsGenerating(false);
    }
  };
  
  const handleAssembleScript = () => {
    const assembledContent = state.scriptParts.map(p => `## Part ${p.partNumber}: ${p.partTitle}\n\n${p.draftText}`).join('\n\n');
    updateState({ fullScript: assembledContent });
  };

  const stageStatus = state.stageStatuses[currentStageId];
  const stageName = STAGES.find(s => s.id === currentStageId)?.name || '';
  const currentReport = state.supervisorReports[currentStageId];

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 text-slate-900 overflow-hidden font-sans relative">
      <TopBar 
        currentStage={currentStageId} 
        stageStatuses={state.stageStatuses} 
        onSelectStage={setCurrentStageId} 
      />
      
      {warningMessage && (
        <div className="bg-amber-100 text-amber-900 px-6 py-3 text-sm font-bold border-b border-amber-200">
          ⚠️ {warningMessage}
        </div>
      )}
      
      {generationAttempt > 0 && (
        <div className="bg-sky-600 text-white px-6 py-3 text-sm font-semibold border-b border-sky-700 flex justify-between items-center animate-pulse shrink-0">
          <div className="flex items-center gap-2">
            <span className="inline-block animate-spin mr-1">⏳</span>
            <span>Nova is thinking... Attempt {generationAttempt} of {generationMaxAttempts}</span>
          </div>
          <span className="text-[10px] uppercase font-mono tracking-wider bg-sky-700 px-2 py-0.5 rounded font-black">
            Vertex AI Retry Mode
          </span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <LeftPanel 
          state={state} 
          updateState={updateState}
          onResetProject={handleResetProject}
          saveStatus={saveStatus}
        />
        
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <RightPanel 
            currentStageId={currentStageId}
            stageName={stageName}
            stageStatus={stageStatus}
            stageContent={getStageContent(currentStageId)}
            updateStageContent={(content) => setStageContent(currentStageId, content)}
            onGenerate={handleGenerate}
            onApproveAndLock={handleApproveAndLock}
            onUnlockStage={() => handleUnlockStage(currentStageId)}
            onSendToNext={handleSendToNext}
            exportSettings={state.cleanExportSettings}
            updateExportSettings={updateExportSettings}
            scriptParts={state.scriptParts}
            updateScriptPart={updateScriptPart}
            onInitScriptParts={handleInitScriptParts}
            onGeneratePart={handleGeneratePart}
            onGenerateAllParts={handleGenerateAllParts}
            onStopBatchGeneration={handleStopBatchGeneration}
            onClearAllParts={handleClearAllParts}
            onClearPart={handleClearPart}
            isBatchGenerating={isBatchGenerating}
            onCheckPart={handleCheckPart}
            onAssembleScript={handleAssembleScript}
          />
          
          <SupervisorPanel 
            report={currentReport}
            isGenerating={isGenerating}
            onAnalyze={handleAnalyze}
            onApplyRepair={handleApplyRepair}
            onApproveAnyway={handleApproveAnyway}
            onProceed={handleSendToNext}
          />
        </div>
      </div>
      
      {/* Dev Bug Tool */}
      <button 
        onClick={() => setShowDebug(true)}
        className="absolute bottom-4 right-4 p-2 bg-slate-900 text-white rounded-full shadow-lg hover:bg-slate-800 transition-colors z-40 opacity-70 hover:opacity-100"
        title="Debug Project State"
      >
        <Bug className="w-4 h-4" />
      </button>

      {/* Debug Modal */}
      {showDebug && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-8">
          <div className="bg-slate-900 text-slate-300 w-full max-w-6xl h-full flex flex-col border border-slate-700 shadow-2xl rounded-sm overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-slate-800 text-white shrink-0">
               <h3 className="font-mono text-sm font-bold flex items-center gap-2"><Bug className="w-4 h-4 text-emerald-500" /> SYSTEM STATE (Developer Mode)</h3>
               <button onClick={() => setShowDebug(false)} className="hover:text-red-400"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="flex-1 flex overflow-hidden">
              <div className="w-1/4 border-r border-slate-800 flex flex-col">
                <div className="p-3 border-b border-slate-800 bg-slate-900/50 font-bold text-xs uppercase tracking-wider text-slate-400">
                  Prompt Registry
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  {Object.entries(state.promptRegistry).map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-1">
                      <label className="text-[10px] font-mono text-slate-400">{key}</label>
                      <textarea
                        className="bg-slate-800 border border-slate-700 text-slate-300 text-xs p-2 rounded-sm focus:border-blue-500 focus:outline-none min-h-[60px]"
                        value={value}
                        onChange={(e) => updateState({ 
                          promptRegistry: { ...state.promptRegistry, [key]: e.target.value } 
                        })}
                      />
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex-1 flex flex-col border-r border-slate-800">
                <div className="p-3 border-b border-slate-800 bg-slate-900/50 font-bold text-xs uppercase tracking-wider text-slate-400 flex justify-between items-center">
                  <span>Active Prompts (Phase Four)</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                          import('./lib/PromptBuilder').then(({ buildSupervisorPrompt }) => {
                             const built = buildSupervisorPrompt(currentStageId, "[DRAFT OUTPUT]", state);
                             alert("Built Supervisor Prompt:\n\n" + built);
                          });
                      }}
                      className="px-3 py-1 bg-amber-900/30 text-amber-500 hover:text-amber-400 text-[10px] border border-amber-900/50 rounded-sm hover:-translate-y-px transition-transform"
                    >
                      Test Supervisor Prompt
                    </button>
                    <button 
                      onClick={() => {
                          import('./lib/PromptBuilder').then(({ buildPrompt }) => {
                             const built = buildPrompt(currentStageId, state);
                             alert("Built Prompt Preview:\n\n" + built);
                          });
                      }}
                      className="px-3 py-1 bg-blue-900/30 text-blue-400 hover:text-blue-300 text-[10px] border border-blue-900/50 rounded-sm hover:-translate-y-px transition-transform"
                    >
                      Test Script Prompt
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-emerald-500">Active Global Rules Prompt</label>
                    <pre className="bg-slate-950 p-2 rounded border border-slate-800 whitespace-pre-wrap">{state.promptRegistry.globalRulesPrompt}</pre>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-emerald-500">Active AI Supervisor Prompt</label>
                    <pre className="bg-slate-950 p-2 rounded border border-slate-800 whitespace-pre-wrap">{state.promptRegistry.aiSupervisorPrompt}</pre>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-blue-400">Last Built Prompt</label>
                    <pre className="bg-slate-950 p-2 rounded border border-slate-800 whitespace-pre-wrap text-blue-300">
                      {state.promptHistory.find(h => h.supervisorStatus === null)?.promptUsed || 'No generated prompts yet.'}
                    </pre>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-amber-500">Last Supervisor Prompt</label>
                    <pre className="bg-slate-950 p-2 rounded border border-slate-800 whitespace-pre-wrap text-amber-300">
                      {state.promptHistory.find(h => h.supervisorStatus !== null)?.promptUsed || 'No supervisor prompts yet.'}
                    </pre>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-amber-500">Last Supervisor Response</label>
                    <pre className="bg-slate-950 p-2 rounded border border-slate-800 whitespace-pre-wrap text-amber-300">
                      {state.promptHistory.find(h => h.supervisorStatus !== null)?.outputPreview || 'No supervisor responses yet.'}
                    </pre>
                  </div>
                </div>
              </div>
              
              <div className="w-1/4 flex flex-col">
                <div className="p-3 border-b border-slate-800 bg-slate-900/50 font-bold text-xs uppercase tracking-wider text-slate-400">
                  State JSON
                </div>
                <div className="flex-2 overflow-y-auto p-4 border-b border-slate-800 font-mono text-[11px] leading-relaxed">
                  <pre>{JSON.stringify(state, null, 2)}</pre>
                </div>
                <div className="flex-1 overflow-y-auto p-4 bg-slate-950 font-mono text-[10px] text-slate-500">
                  <h4 className="text-slate-400 mb-2 uppercase tracking-wide">Prompt History ({state.promptHistory.length})</h4>
                  {state.promptHistory.length === 0 && <p className="opacity-50">No generations yet.</p>}
                  {state.promptHistory.map(h => (
                    <div key={h.id} className="mb-2 p-2 border border-slate-800 rounded-sm">
                      <span className="text-emerald-700 font-bold">{h.stageId}</span> - Date: {new Date(h.createdAt).toLocaleTimeString()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
