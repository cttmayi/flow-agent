export class ToolRegistry {
  #tools = new Map();

  register(def) {
    this.#tools.set(def.name, def);
  }

  get(name) {
    return this.#tools.get(name);
  }

  list() {
    return [...this.#tools.values()];
  }

  toAnthropicTools(names) {
    return names.map(name => {
      const tool = this.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      };
    });
  }

  async execute(name, args) {
    const tool = this.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.execute(args);
  }
}