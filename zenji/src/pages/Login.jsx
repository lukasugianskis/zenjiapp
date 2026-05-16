import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db, googleProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, setDoc, doc } from "../firebase";

// Initialize user doc with default values if it doesn't exist
const initializeUserDoc = async (uid) => {
  try {
    const userRef = doc(db, "users", uid);
    await setDoc(userRef, {
      streak: 0,
      coins: 0,
      lightning: 0,
    }, { merge: true });
  } catch (err) {
    console.error("Error initializing user doc:", err);
  }
};

export default function Login(){
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleGoogle = async () => {
    try{
      const result = await signInWithPopup(auth, googleProvider);
      await initializeUserDoc(result.user.uid);
      navigate('/packs');
    }catch(err){
      setError(err.message);
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    try{
      const result = await signInWithEmailAndPassword(auth, email, password);
      await initializeUserDoc(result.user.uid);
      navigate('/packs');
    }catch(err){
      setError(err.message);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    try{
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await initializeUserDoc(result.user.uid);
      navigate('/packs');
    }catch(err){
      setError(err.message);
    }
  };

  return (
    <div style={{display:'grid',placeItems:'center',minHeight:'80vh'}}>
      <div style={{width:360,background:'#fff',padding:24,borderRadius:12,boxShadow:'0 8px 30px rgba(0,0,0,0.08)'}}>
        <h2 style={{marginTop:0}}>Sign in</h2>
        {error && <div style={{color:'crimson',marginBottom:8}}>{error}</div>}
        <form onSubmit={handleEmailLogin}>
          <label style={{display:'block',marginBottom:8}}>Email</label>
          <input value={email} onChange={(e)=>setEmail(e.target.value)} style={{width:'100%',padding:8,borderRadius:8,border:'1px solid #e5e7eb'}} />
          <label style={{display:'block',margin:'12px 0 8px'}}>Password</label>
          <input value={password} type="password" onChange={(e)=>setPassword(e.target.value)} style={{width:'100%',padding:8,borderRadius:8,border:'1px solid #e5e7eb'}} />
          <div style={{display:'flex',gap:8,marginTop:12}}>
            <button style={{flex:1,padding:10,borderRadius:8}} type="submit">Sign in</button>
            <button style={{flex:1,padding:10,borderRadius:8}} onClick={handleRegister}>Register</button>
          </div>
        </form>
        <hr style={{margin:'16px 0'}} />
        <button onClick={handleGoogle} style={{width:'100%',padding:10,borderRadius:8}}>Sign in with Google</button>
      </div>
    </div>
  );
}
