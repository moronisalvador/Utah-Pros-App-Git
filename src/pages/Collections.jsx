import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import ARDashboard from '@/components/collections/ARDashboard';

export default function Collections() {
  const { db } = useAuth();
  const navigate = useNavigate();
  return <ARDashboard db={db} navigate={navigate} />;
}
