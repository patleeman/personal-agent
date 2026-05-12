function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/knowledgeVault must be resolved by the Personal Agent host runtime.');
}

export const knowledgeVault: Record<string, any> = new Proxy(
  {},
  {
    get() {
      return (..._args: any[]): any => hostResolved();
    },
  },
);
