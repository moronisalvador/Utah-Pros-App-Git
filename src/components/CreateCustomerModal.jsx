import AddContactModal from './AddContactModal';

/**
 * Thin wrapper so Layout can lazy-load this without creating
 * a circular dep through CreateJobModal → AddContactModal
 */
export default function CreateCustomerModal({ onClose, onSave, carriers, referralSources }) {
  return (
    <AddContactModal
      onClose={onClose}
      onSave={onSave}
      carriers={carriers || []}
      referralSources={referralSources || []}
      defaultRole="homeowner"
    />
  );
}
