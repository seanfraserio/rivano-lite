import type { PipelineContext, PipelineResult } from "@rivano/core";

export interface Middleware {
  name: string;
  execute(ctx: PipelineContext, config?: unknown): Promise<PipelineResult>;
}

export class Pipeline {
  private middlewares: Middleware[];

  constructor(middlewares: Middleware[]) {
    this.middlewares = middlewares;
  }

  async execute(ctx: PipelineContext): Promise<PipelineResult> {
    for (const mw of this.middlewares) {
      const result = await mw.execute(ctx);

      ctx.decisions.push({
        middleware: mw.name,
        result,
      });

      if (result === "block" || result === "short-circuit") {
        return result;
      }
    }

    return "continue";
  }
}
