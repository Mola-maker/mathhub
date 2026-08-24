/** Host-side, provider-independent recognition of explicit read-only artifacts. */
export function requestsGeometryFlowWidget(problem: string): boolean {
  return /(?:\bproof\s*flow\b|\bflow\s*diagram\b|\u52a8\u6001(?:\u51e0\u4f55)?(?:\u6d41\u7a0b\u56fe|\u63a8\u5bfc|\u6b65\u9aa4)|(?:\u51e0\u4f55)?\u6d41\u7a0b\u56fe|\u6b65\u9aa4\u6f14\u793a|(?:\u6784\u9020|\u89e3\u9898|\u63a8\u5bfc)\u6b65\u9aa4|\u63a8\u5bfc\u8fc7\u7a0b)/iu
    .test(problem);
}

export function requestsReadOnlyAgentWidget(problem: string): boolean {
  return /\bwidget\b/iu.test(problem)
    || requestsGeometryFlowWidget(problem)
    || /(?:\u4ea4\u4e92(?:\u5f0f)?(?:\u51fd\u6570\u56fe|\u56fe\u8868)|\u51fd\u6570\u56fe\s*(?:\u5361\u7247|\u7ec4\u4ef6))/iu
      .test(problem);
}
