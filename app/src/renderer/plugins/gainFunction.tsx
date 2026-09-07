import { registerPlugin, type FunctionPluginProps } from './registry';

export function GainFunctionControl({ control, value, onValue }: FunctionPluginProps) {
  return (
    <div className="gain-plugin function-gain-plugin">
      <label>
        <span>gain()</span>
        <output>{value.toFixed(2)}</output>
        <input
          aria-label="Function gain"
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={value}
          onChange={(event) => onValue(Number(event.currentTarget.value))}
        />
      </label>
    </div>
  );
}

registerPlugin({
  id: 'function-gain',
  label: 'GAIN',
  kind: 'functional',
  scope: 'function',
  functionNames: ['gain'],
  control: {
    kind: 'number',
    id: 'gain',
    label: 'gain',
    argumentIndex: 0,
    min: 0,
    max: 2,
    step: 0.01,
    defaultValue: 1,
  },
  mount: GainFunctionControl,
});
