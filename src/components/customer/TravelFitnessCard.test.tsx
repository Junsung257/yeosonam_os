import { renderToString } from 'react-dom/server';
import TravelFitnessCard from './TravelFitnessCard';

const monthlyNormals = [
  {
    month: 8,
    temp_max: 31,
    temp_min: 24,
    temp_mean: 28,
    rain_days: 8,
    rain_mm: 140,
    humidity: 75,
    sunshine_hours: 6,
  },
];

const fitnessScores = [
  {
    month: 8,
    score: 62,
    label: '준비 권장',
    key_concern: '우기 대비',
    metrics: { temp: 80, rain: 55, humidity: 76, crowd: 62 },
  },
];

describe('TravelFitnessCard', () => {
  it('renders when seasonal signals are an empty database array', () => {
    expect(() => renderToString(
      <TravelFitnessCard
        destination="서안"
        primaryCity="서안"
        country="베트남"
        monthlyNormals={monthlyNormals}
        fitnessScores={fitnessScores}
        seasonalSignals={[]}
        representativeMonth={8}
      />,
    )).not.toThrow();
  });
});
