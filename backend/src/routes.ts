import express, { NextFunction, Request, Response } from 'express'
import { getDevice, listDevices } from './devices'
import { createRollout, getRollout, validateRollout } from './ota'
import { getShadow, setDesired, validateDesired } from './shadow'

export const app = express()
app.use(express.json())

app.get('/devices', async (_req, res) => {
  res.json(await listDevices())
})

app.get('/devices/:id', async (req, res) => {
  const device = await getDevice(req.params.id)
  if (!device) return void res.status(404).json({ error: 'unknown device' })
  res.json({ ...device, shadow: await getShadow(device.id) })
})

app.put('/devices/:id/desired', async (req, res) => {
  const device = await getDevice(req.params.id)
  if (!device) return void res.status(404).json({ error: 'unknown device' })
  const error = validateDesired(req.body)
  if (error) return void res.status(400).json({ error })
  await setDesired(device.id, req.body)
  res.json({ ...device, shadow: await getShadow(device.id) })
})

app.post('/ota/rollouts', async (req, res) => {
  const error = validateRollout(req.body)
  if (error) return void res.status(400).json({ error })
  const { targetVersion, stages, failureThresholdPct } = req.body
  const id = await createRollout(targetVersion, stages, failureThresholdPct)
  if (!id) return void res.status(409).json({ error: 'no online devices to roll out to' })
  res.status(201).json(await getRollout(id))
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

app.get('/ota/rollouts/:id', async (req, res) => {
  const rollout = UUID.test(req.params.id) ? await getRollout(req.params.id) : null
  if (!rollout) return void res.status(404).json({ error: 'unknown rollout' })
  res.json(rollout)
})

// Express 5 forwards errors from async handlers here.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'internal error' })
})
