const MagLegend = () => {
  return (
    <div className="bg-white shadow rounded-lg p-4 max-w-lg mx-auto my-10">
      <div className="text-xl font-semibold mb-4">Magnitude Abbreviations</div>
      <p>For token supply numbers.</p>
      <div className="grid grid-cols-2 gap-4">
        <div className="text-gray-600">1 (no abbreviation)</div>
        <div className="font-mono">1</div>
        <div className="text-gray-600">Thousand (K)</div>
        <div className="font-mono">1K = 1,000</div>
        <div className="text-gray-600">Million (M)</div>
        <div className="font-mono">1M = 1,000,000</div>
        <div className="text-gray-600">Billion (B)</div>
        <div className="font-mono">1B = 1,000,000,000</div>
        <div className="text-gray-600">Trillion (T)</div>
        <div className="font-mono">1T = 1,000,000,000,000</div>
        <div className="text-gray-600">Quadrillion (P)</div>
        <div className="font-mono">1P = 1,000,000,000,000,000</div>
        <div className="text-gray-600">Quintillion (E)</div>
        <div className="font-mono">1E = 1,000,000,000,000,000,000</div>p
      </div>
    </div>
  );
};

export default MagLegend;
