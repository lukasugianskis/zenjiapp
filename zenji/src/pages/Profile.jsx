import { useNavigate } from "react-router-dom";

export default function Profile() {
  const navigate = useNavigate();
  return (
    <section className="profile-page">
      <div className="packs-page__container">
        <div className="packs-page__header">
          <button className="packs-modal__button packs-modal__button--secondary" onClick={() => navigate(-1)}>
            Back
          </button>
          <h1 className="packs-page__title">Profile</h1>
        </div>

        <p>This is a placeholder for the Profile page.</p>
      </div>
    </section>
  );
}
