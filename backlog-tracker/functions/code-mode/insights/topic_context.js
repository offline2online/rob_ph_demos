// Everything the console holds on one topic, as the cached context pack
// (functions/context → get_topic_context). The pack is already compact,
// ranked, deduplicated and capped, so the insight returns it as it is.
"use strict";

module.exports = {
  name: "topic_context",
  version: 1,
  description: "Everything on one topic in one compact pack: a summary, the key records per source with links, open items and blockers, recent decisions, what changed since the pack was last built, and related topics. The topic is free text, or a project, concept or lead by id or name. Recently used topics come back from the cache.",
  params: [
    { name: "topic", type: "string", required: true, description: "Free text, or the id or name of a project, a concept or a lead." },
    { name: "refresh", type: "string", required: false, description: "\"true\" to rebuild the pack from scratch instead of using the cache." },
  ],
  run: async function (tools, params) {
    const pack = await tools.get_topic_context(Object.assign({ topic: params.topic }, params.refresh === "true" ? { refresh: true } : {}));
    // The sandbox returns at most 20 KB: the pack is built to fit.
    return pack;
  },
};
