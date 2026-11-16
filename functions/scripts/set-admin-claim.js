import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const args = process.argv.slice(2)
const email = args.find((arg) => arg.includes('@'))
const revoke = args.includes('--revocar')
const confirmed = args.at(-2) === '--confirmar' && args.at(-1) === 'cumpleheyli'

if (!email || !confirmed) {
  console.error('Uso: node scripts/set-admin-claim.js correo@dominio.com --confirmar cumpleheyli')
  console.error('Para retirar: node scripts/set-admin-claim.js correo@dominio.com --revocar --confirmar cumpleheyli')
  process.exit(1)
}

initializeApp({
  credential: applicationDefault(),
  projectId: 'cumpleheyli'
})

const auth = getAuth()
const user = await auth.getUserByEmail(email)
await auth.setCustomUserClaims(user.uid, { admin: !revoke })
console.log(revoke
  ? `Se retiró el permiso admin de ${email}.`
  : `Se otorgó el permiso admin a ${email}.`)
console.log('Esa persona debe cerrar sesión y volver a entrar para renovar su token.')
console.log('Este comando no crea contraseñas ni usuarios. El usuario ya debe existir en Authentication.')
