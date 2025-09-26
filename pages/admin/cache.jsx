import { useEffect, useState } from 'react';
import AuthGate from '../../components/AuthGate';
import NavBar from '../../components/NavBar';

export default function CacheAdmin() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stock-cache');
      const json = await res.json();
      if (res.ok) setList(json.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, []);

  const handleDelete = async (ticker) => {
    if (!confirm(`Delete cached ticker ${ticker}?`)) return;
    try {
      const res = await fetch(`/api/stock-cache?ticker=${encodeURIComponent(ticker)}`, { method: 'DELETE' });
      if (res.ok) fetchList();
      else alert('Delete failed');
    } catch (e) {
      alert('Delete failed');
    }
  };

  return (
    <AuthGate>
      <NavBar />
      <div style={{ padding: 24, marginLeft: 300 }}>
        <h1>Cached Stock History</h1>
        {loading && <div>Loading...</div>}
        {!loading && list.length === 0 && <div>No cached tickers</div>}
        {!loading && list.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Company</th>
                <th>Ticker</th>
                <th>Start</th>
                <th>End</th>
                <th>Updated At</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.ticker}>
                  <td>{r.company_name || '-'}</td>
                  <td>{r.ticker}</td>
                  <td>{r.start_date}</td>
                  <td>{r.end_date}</td>
                  <td>{r.updated_at}</td>
                  <td><button onClick={() => handleDelete(r.ticker)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AuthGate>
  );
}
