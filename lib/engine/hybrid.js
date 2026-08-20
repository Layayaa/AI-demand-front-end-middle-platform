'use strict';
/* 混合模式澄清编排（LLM 自主追问 + 规则校验画像 + 交付前自检缺口）
   骨架仍是 interview.js 的规则状态机（确定性、可终止、可兜底）；
   LLM 负责：每轮自主决定怎么问、确认阶段做画像自检并追缺口。
   画像上的临时状态：llmGaps / llmGapIndex / llmGapsActive / llmReviewDone（向后兼容，done 时清除） */
const interview = require('./interview');
const llm = require('./llm');

function askGap(profile) {
  const idx = profile.llmGapIndex || 0;
  const g = profile.llmGaps[idx];
  const total = profile.llmGaps.length;
  return {
    text: `📋 交付前自检（${idx + 1}/${total}）\n\n${g.question}\n\n> ${g.reason}\n\n回复「**跳过**」可跳过该项。`,
    suggestions: ['跳过', '没有了']
  };
}

function finalConfirm(profile) {
  return { text: interview.buildSummary(profile) };
}

async function hybridReply(requirement, userText, turn, settings, knowledgeContext) {
  const profile = requirement.profile;

  // 0) 用户已确认（没问题/没有了）→ 收尾
  if (turn.done) {
    profile.llmGaps = null;
    profile.llmGapsActive = false;
    profile.llmReviewDone = true;
    return {
      text: '✅ 需求画像已确认！完整度 **' + (profile.completeness || 0) + '%**。\n\n点击右侧「**生成三档方案**」，我会输出初级、中级、高级三档，每档各含产品版与技术版，共 6 份文档。',
      suggestions: []
    };
  }

  // 1) 确认阶段
  if (profile.stage === 'confirm') {
    // 1a) 缺口问答进行中：记录本轮回答，推进
    if (profile.llmGapsActive && Array.isArray(profile.llmGaps)) {
      const idx = profile.llmGapIndex || 0;
      if (idx < profile.llmGaps.length) {
        profile.llmGaps[idx].answer = userText;
        profile.llmGaps[idx].status = 'answered';
        profile.llmGapIndex = idx + 1;
      }
      if ((profile.llmGapIndex || 0) < profile.llmGaps.length) return askGap(profile);
      profile.llmGapsActive = false;
      return finalConfirm(profile);
    }
    // 1b) 首次到达确认阶段 → 交付前自检（LLM 反思）
    if (!profile.llmReviewDone) {
      profile.llmReviewDone = true;
      let review = { summary: '', gaps: [] };
      try {
        review = await llm.reviewProfile(settings, requirement, knowledgeContext);
      } catch (e) {
        console.error('[llm] 画像自检失败，跳过缺口追问:', e.message);
      }
      const gaps = (review.gaps || []).filter(g => g && g.question);
      profile.llmGaps = gaps.map(g => ({ question: g.question, reason: g.reason || '', answer: '', status: 'pending' }));
      profile.llmGapIndex = 0;
      if (gaps.length) {
        profile.llmGapsActive = true;
        return askGap(profile);
      }
      profile.llmGapsActive = false;
      if (review.summary) {
        return { text: review.summary + '\n\n回复「**没问题**」确认画像，即可生成三档方案。', suggestions: ['没问题'] };
      }
    }
    // 1c) 补充/修正后的确认阶段
    return finalConfirm(profile);
  }

  // 2) 常规轮：LLM 自主追问（带规则引擎的缺失项上下文）
  const missing = interview.missingFields(profile);
  const text = await llm.clarify(settings, requirement, requirement.chat, {
    missing,
    completeness: profile.completeness,
    knowledgeContext
  });
  return { text, suggestions: [] };
}

module.exports = { hybridReply };
