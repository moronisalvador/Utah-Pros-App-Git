import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import ARPage from '@/components/collections/ARPage';

export default function Collections() {
  const { db } = useAuth();
  const navigate = useNavigate();
  return <ARPage db={db} navigate={navigate} />;
}
