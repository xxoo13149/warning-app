import { describe, expect, it } from 'vitest';

import {
  formatAlertMessage,
  formatBuiltinRuleDescription,
  formatBuiltinRuleName,
} from '../../src/shared/alert-display';

describe('alert display abnormal lottery copy', () => {
  it('formats abnormal lottery builtin rule metadata in readable Chinese', () => {
    expect(formatBuiltinRuleName('abnormal_lottery', 'zh-CN')).toBe('异常彩票');
    expect(formatBuiltinRuleDescription('abnormal_lottery', 'zh-CN')).toContain('超低价 YES 卖一');
  });

  it('formats abnormal lottery alert body in readable Chinese', () => {
    const message = formatAlertMessage('zh-CN', {
      messageKey: 'abnormal_lottery',
      messageParams: {
        outcome: 'yes',
        previous: 0.02,
        actual: 0.05,
        threshold: 0.03,
        source: 'book_depth',
        effectiveSize: 150,
        effectiveNotional: 7.5,
      },
      marketSnapshot: {
        cityName: '北京',
        airportCode: 'ZBAA',
        temperatureBand: '70°F to 71°F',
      },
    });

    expect(message).toContain('异常彩票');
    expect(message).toContain('超低价卖一从');
    expect(message).toContain('推高到');
    expect(message).toContain('触发阈值');
    expect(message).toContain('有效量 150 张 / $7.50');
  });
});
